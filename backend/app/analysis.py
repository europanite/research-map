"""Deterministic, explainable multi-view similarity + classical metric MDS."""
from __future__ import annotations

import math

import httpx
import numpy as np
from sklearn.cluster import AgglomerativeClustering
from sklearn.feature_extraction.text import TfidfVectorizer

from .config import settings
from .openalex import ProviderError


def _normalize_similarity(matrix: np.ndarray) -> np.ndarray:
    """Normalize nonzero scores to a comparable (0,1] range without inventing edges."""
    positive = matrix[np.triu_indices_from(matrix, 1)]
    positive = positive[positive > 0]
    if positive.size:
        divisor = float(np.percentile(positive, 90))
        if divisor > 1e-10:
            matrix = np.minimum(matrix / divisor, 1.0)
    np.fill_diagonal(matrix, 1.0)
    return matrix


async def _text_similarity(papers: list[dict]) -> tuple[np.ndarray, str]:
    docs = [f"{p['title']}. {p['title']}. {p['abstract'][:7000]}" for p in papers]
    n = len(docs)
    if settings.embedding_provider == "ollama":
        embeddings = []
        try:
            async with httpx.AsyncClient(timeout=150.0) as client:
                for start in range(0, n, 16):
                    response = await client.post(
                        f"{settings.ollama_url.rstrip('/')}/api/embed",
                        json={"model": settings.ollama_model, "input": docs[start:start + 16]},
                    )
                    response.raise_for_status()
                    embeddings.extend(response.json()["embeddings"])
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            raise ProviderError("Local Ollama embeddings unavailable. Start Ollama and pull the configured model, or switch EMBEDDING_PROVIDER=tfidf.", 503) from exc
        x = np.asarray(embeddings, dtype=np.float64)
        if x.shape[0] != n or not np.isfinite(x).all():
            raise ProviderError("Ollama returned an invalid embedding batch.", 502)
        x /= np.maximum(np.linalg.norm(x, axis=1, keepdims=True), 1e-12)
        sim = x @ x.T
        return _normalize_similarity(np.maximum(sim, 0)), f"ollama:{settings.ollama_model}"
    if settings.embedding_provider != "tfidf":
        raise ProviderError("Unsupported EMBEDDING_PROVIDER setting.", 500)
    try:
        vectorizer = TfidfVectorizer(
            lowercase=True, strip_accents="unicode", stop_words="english",
            ngram_range=(1, 2), sublinear_tf=True, max_features=18000,
        )
        features = vectorizer.fit_transform(docs)
        sim = (features @ features.T).toarray()
    except ValueError:
        sim = np.eye(n, dtype=np.float64)
    return _normalize_similarity(np.maximum(sim, 0)), "tfidf"


def _jaccard(a: set, b: set) -> float:
    union = a | b
    return len(a & b) / len(union) if union else 0.0


def _structural_similarity(papers: list[dict]) -> tuple[np.ndarray, np.ndarray, list[tuple[int, int]]]:
    n = len(papers)
    authors = [set(p.get("author_ids") or []) for p in papers]
    refs = [set(p.get("referenced_works") or []) for p in papers]
    ids = {p["id"]: i for i, p in enumerate(papers)}
    author_sim = np.eye(n, dtype=np.float64)
    citation_sim = np.eye(n, dtype=np.float64)
    citation_links = []
    for i in range(n):
        for referenced_id in refs[i]:
            j = ids.get(referenced_id)
            if j is not None and i != j:
                citation_links.append((i, j))
        for j in range(i + 1, n):
            author_sim[i, j] = author_sim[j, i] = _jaccard(authors[i], authors[j])
            bibliographic = _jaccard(refs[i], refs[j])
            direct_citation = int(papers[j]["id"] in refs[i] or papers[i]["id"] in refs[j])
            citation_sim[i, j] = citation_sim[j, i] = 0.55 * bibliographic + 0.45 * direct_citation
    return _normalize_similarity(author_sim), _normalize_similarity(citation_sim), citation_links


def _embed_3d(sim: np.ndarray) -> np.ndarray:
    """Classical MDS on fused distance matrix, avoids nonlinear stochastic maps."""
    n = len(sim)
    if n == 1:
        return np.zeros((1, 3))
    distance = np.sqrt(np.maximum(0.0, 1.0 - sim))
    distance_sq = distance ** 2
    centering = np.eye(n) - np.ones((n, n)) / n
    gram = -0.5 * centering @ distance_sq @ centering
    eigenvalues, eigenvectors = np.linalg.eigh(gram)
    order = np.argsort(eigenvalues)[::-1][:3]
    coords = eigenvectors[:, order] * np.sqrt(np.maximum(eigenvalues[order], 0))
    if coords.shape[1] < 3:
        coords = np.pad(coords, ((0, 0), (0, 3 - coords.shape[1])))
    # Resolve sign ambiguity deterministically.
    for column in range(3):
        pivot = int(np.argmax(np.abs(coords[:, column])))
        if coords[pivot, column] < 0:
            coords[:, column] *= -1
    max_extent = float(np.max(np.linalg.norm(coords, axis=1)))
    if max_extent > 1e-12:
        coords *= 4.5 / max_extent
    return coords


def _clusters(sim: np.ndarray) -> list[int]:
    n = len(sim)
    if n < 3:
        return [0] * n
    groups = min(7, max(2, int(math.sqrt(n) / 1.8) + 1), n - 1)
    labels = AgglomerativeClustering(
        n_clusters=groups, metric="precomputed", linkage="average"
    ).fit_predict(np.clip(1 - sim, 0, 1))
    return [int(v) for v in labels]


async def build_map(papers: list[dict], weights: dict) -> tuple[list[dict], list[dict], dict]:
    n = len(papers)
    if not n:
        raise ValueError("At least one paper is required")
    abstract_sim, method = await _text_similarity(papers)
    authors_sim, citations_sim, citation_links = _structural_similarity(papers)
    components = {"abstract": abstract_sim, "authors": authors_sim, "citations": citations_sim}
    available = {
        key: bool(np.any(values[np.triu_indices(n, 1)] > 1e-12))
        for key, values in components.items()
    }
    active_weights = {k: weights[k] if available[k] else 0.0 for k in components}
    if sum(active_weights.values()) <= 0:
        active_weights = {"abstract": 1.0, "authors": 0.0, "citations": 0.0}
    total = sum(active_weights.values())
    fused = sum(active_weights[k] * components[k] for k in components) / total
    fused = np.clip(fused, 0, 1)
    np.fill_diagonal(fused, 1)
    coords = _embed_3d(fused)
    clusters = _clusters(fused)

    points = []
    for i, p in enumerate(papers):
        public_paper = {k: p[k] for k in ("id", "title", "abstract", "year", "cited_by_count", "authors", "doi", "url")}
        points.append({
            "id": p["id"], "x": round(float(coords[i, 0]), 5),
            "y": round(float(coords[i, 1]), 5), "z": round(float(coords[i, 2]), 5),
            "cluster": clusters[i], "paper": public_paper,
        })
    citation_pairs = {(i, j) for i, j in citation_links}
    citation_undirected = {tuple(sorted((i, j))) for i, j in citation_links}
    edges = [
        {"source": papers[i]["id"], "target": papers[j]["id"], "kind": "citation", "strength": round(float(fused[i, j]), 4)}
        for i, j in sorted(citation_pairs)
    ]
    neighbor_edges = set()
    for i in range(n):
        neighbor_ids = np.argsort(fused[i])[::-1]
        count = 0
        for j in neighbor_ids:
            j = int(j)
            if i == j or fused[i, j] < 0.23:
                continue
            pair = tuple(sorted((i, j)))
            if pair not in citation_undirected:
                neighbor_edges.add(pair)
            count += 1
            if count >= 2:
                break
    for i, j in sorted(neighbor_edges, key=lambda ij: fused[ij], reverse=True)[:240]:
        edges.append({
            "source": papers[i]["id"], "target": papers[j]["id"],
            "kind": "similarity", "strength": round(float(fused[i, j]), 4),
        })
    metrics = {
        "papers": n,
        "citation_links": len(citation_pairs),
        "similarity_links": sum(e["kind"] == "similarity" for e in edges),
        "unique_authors": len({a for p in papers for a in p.get("author_ids", [])}),
        "available_signals": available,
        "effective_weights": {k: round(v / total, 4) for k, v in active_weights.items()},
        "embedding_method": method,
        "map_method": "classical_mds",
        "similarity_explanation": "weighted text cosine + author Jaccard + bibliographic coupling/direct citation",
    }
    return points, edges, metrics
