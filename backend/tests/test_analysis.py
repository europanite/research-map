import asyncio
import math

import numpy as np
import pytest

from app.analysis import _embed_3d, _structural_similarity, build_map


PAPERS = [
    {"id": "W1", "title": "Interpretable neural classifiers", "abstract": "Gradient feature saliency explains classification decisions for image classifiers.",
     "year": 2023, "cited_by_count": 18, "authors": [{"id": "A1", "name": "A"}, {"id": "A2", "name": "B"}], "author_ids": ["A1", "A2"],
     "referenced_works": ["W2", "W9", "W10"], "doi": None, "url": "https://openalex.org/W1"},
    {"id": "W2", "title": "Gradient visualization for neural networks", "abstract": "Feature gradient visualization can interpret image neural classifiers.",
     "year": 2022, "cited_by_count": 31, "authors": [{"id": "A2", "name": "B"}], "author_ids": ["A2"],
     "referenced_works": ["W9", "W10"], "doi": None, "url": "https://openalex.org/W2"},
    {"id": "W3", "title": "Evolution strategies and convergence", "abstract": "Natural evolution strategy optimization with Gaussian distributions and search.",
     "year": 2024, "cited_by_count": 9, "authors": [{"id": "A3", "name": "C"}], "author_ids": ["A3"],
     "referenced_works": ["W98"], "doi": None, "url": "https://openalex.org/W3"},
    {"id": "W4", "title": "Population based global optimization", "abstract": "Evolutionary strategies use populations to improve global parameter search.",
     "year": 2020, "cited_by_count": 12, "authors": [{"id": "A4", "name": "D"}], "author_ids": ["A4"],
     "referenced_works": ["W98", "W3"], "doi": None, "url": "https://openalex.org/W4"},
]


def test_direct_citation_and_author_overlap():
    authors, citations, direct = _structural_similarity(PAPERS)
    assert (0, 1) in direct
    assert (3, 2) in direct
    assert authors[0, 1] > 0
    assert authors[0, 2] == 0
    assert citations[0, 1] > citations[0, 2]


def test_map_3d_and_reweighting_changes_projection():
    a, edges, metrics = asyncio.run(build_map(PAPERS, {"abstract": 1, "authors": 0, "citations": 0}))
    b, _, _ = asyncio.run(build_map(PAPERS, {"abstract": 0, "authors": 0, "citations": 1}))
    assert len(a) == 4
    assert all(math.isfinite(p[axis]) for p in a for axis in ["x", "y", "z"])
    assert a[0]["x"] != b[0]["x"] or a[0]["y"] != b[0]["y"]
    assert any(e["kind"] == "citation" and e["source"] == "W1" and e["target"] == "W2" for e in edges)
    assert metrics["available_signals"] == {"abstract": True, "authors": True, "citations": True}
    assert metrics["embedding_method"] == "tfidf"


def test_classical_mds_small():
    assert _embed_3d(np.eye(1)).shape == (1, 3)
    assert _embed_3d(np.eye(2)).shape == (2, 3)


@pytest.mark.parametrize("weights", [
    {"abstract": 0.5, "authors": 0.5, "citations": 0},
    {"abstract": 0.1, "authors": 0, "citations": 0.9},
])
def test_valid_weight_shapes(weights):
    nodes, _, _ = asyncio.run(build_map(PAPERS, weights))
    assert len({p["id"] for p in nodes}) == len(PAPERS)
