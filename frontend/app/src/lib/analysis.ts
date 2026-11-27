/** Deterministic, browser-only multi-view similarity, classical MDS and grouping. */
import type { AnalysisResult, PaperRecord, Weights } from '../types';
import { technicalTerms } from './technical-terms.ts';

type Matrix = Float64Array;
const index = (n: number, i: number, j: number) => i * n + j;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

// Topic-bearing terms, genuine adjacent phrases, title emphasis and corpus DF.
function vectorize(papers: PaperRecord[]): Map<number, number>[] {
  const vocabulary = new Map<string, number>();
  const df = new Map<string, number>();
  const documents = papers.map(p => {
    const doc = technicalTerms((p.abstract || '').slice(0, 7000));
    for (const [term, count] of technicalTerms(p.title || '')) doc.set(term, (doc.get(term) ?? 0) + 3 * count);
    for (const term of doc.keys()) df.set(term, (df.get(term) ?? 0) + 1);
    return doc;
  });
  return documents.map(doc => {
    let magnitude = 0;
    const vector = new Map<number, number>();
    for (const [term, count] of doc) {
      const frequency = df.get(term)!;
      // Terms appearing in only one document cannot provide shared topical evidence.
      if (frequency < 2 || (papers.length >= 5 && frequency / papers.length >= 0.85)) continue;
      if (!vocabulary.has(term)) vocabulary.set(term, vocabulary.size);
      const idf = Math.log(1 + papers.length / frequency);
      const value = (1 + Math.log(count)) * idf * (term.includes(' ') ? 1.5 : 1);
      vector.set(vocabulary.get(term)!, value);
      magnitude += value * value;
    }
    const norm = Math.sqrt(magnitude) || 1;
    for (const [key, value] of vector) vector.set(key, value / norm);
    return vector;
  });
}

function dotSparse(a: Map<number, number>, b: Map<number, number>): number {
  if (a.size > b.size) return dotSparse(b, a);
  let sum = 0;
  for (const [key, value] of a) sum += value * (b.get(key) || 0);
  return sum;
}
function similarityText(papers: PaperRecord[]): Matrix {
  const n = papers.length;
  const vectors = vectorize(papers);
  const similarity = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    similarity[index(n, i, i)] = 1;
    for (let j = i + 1; j < n; j++) {
      const value = clamp(dotSparse(vectors[i], vectors[j]));
      similarity[index(n, i, j)] = similarity[index(n, j, i)] = value;
    }
  }
  return similarity;
}
function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection++;
  return intersection / (a.size + b.size - intersection);
}
function similarityStructure(papers: PaperRecord[]) {
  const n = papers.length;
  const authors = papers.map(p => new Set(p.author_ids));
  const refs = papers.map(p => new Set(p.referenced_works));
  const byId = new Map(papers.map((p, i) => [p.id, i]));
  const a = new Float64Array(n * n), c = new Float64Array(n * n);
  const citationPairs: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    a[index(n, i, i)] = c[index(n, i, i)] = 1;
    for (const referenced of refs[i]) {
      const target = byId.get(referenced);
      if (target !== undefined && i !== target) citationPairs.push([i, target]);
    }
    for (let j = i + 1; j < n; j++) {
      a[index(n, i, j)] = a[index(n, j, i)] = jaccard(authors[i], authors[j]);
      const direct = refs[i].has(papers[j].id) || refs[j].has(papers[i].id) ? 1 : 0;
      const citation = 0.55 * jaccard(refs[i], refs[j]) + 0.45 * direct;
      c[index(n, i, j)] = c[index(n, j, i)] = citation;
    }
  }
  return { authors: a, citations: c, citationPairs };
}
function hasSignal(matrix: Matrix, n: number): boolean {
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
    if (matrix[index(n, i, j)] > 1e-12) return true;
  return false;
}

/** Symmetric Jacobi eigendecomposition of the double-centered distance matrix. */
function classicalMDS(sim: Matrix, n: number): number[][] {
  if (n === 1) return [[0, 0, 0]];
  const d = new Float64Array(n * n), rowMean = new Float64Array(n);
  let grand = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const val = 1 - sim[index(n, i, j)];
      d[index(n, i, j)] = val;
      rowMean[i] += val / n;
      grand += val / (n * n);
    }
  }
  const gram = new Float64Array(n * n), vectors = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    vectors[index(n, i, i)] = 1;
    for (let j = 0; j < n; j++) {
      gram[index(n, i, j)] = -0.5 * (d[index(n, i, j)] - rowMean[i] - rowMean[j] + grand);
    }
  }
  // Cyclic Jacobi rotations. In-place similarity transforms, no external linear algebra service.
  for (let sweep = 0; sweep < 24; sweep++) {
    let maximum = 0;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const pq = gram[index(n, p, q)];
        maximum = Math.max(maximum, Math.abs(pq));
        if (Math.abs(pq) < 1e-10) continue;
        const tau = (gram[index(n, q, q)] - gram[index(n, p, p)]) / (2 * pq);
        const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const cs = 1 / Math.sqrt(1 + t * t), sn = t * cs;
        const pp = gram[index(n, p, p)], qq = gram[index(n, q, q)];
        gram[index(n, p, p)] = pp - t * pq;
        gram[index(n, q, q)] = qq + t * pq;
        gram[index(n, p, q)] = gram[index(n, q, p)] = 0;
        for (let k = 0; k < n; k++) {
          if (k !== p && k !== q) {
            const kp = gram[index(n, k, p)], kq = gram[index(n, k, q)];
            gram[index(n, k, p)] = gram[index(n, p, k)] = cs * kp - sn * kq;
            gram[index(n, k, q)] = gram[index(n, q, k)] = sn * kp + cs * kq;
          }
          const vp = vectors[index(n, k, p)], vq = vectors[index(n, k, q)];
          vectors[index(n, k, p)] = cs * vp - sn * vq;
          vectors[index(n, k, q)] = sn * vp + cs * vq;
        }
      }
    }
    if (maximum < 1e-9) break;
  }
  const ranked = Array.from({ length: n }, (_, i) => i).sort((a, b) => gram[index(n, b, b)] - gram[index(n, a, a)]).slice(0, 3);
  const result = Array.from({ length: n }, () => [0, 0, 0]);
  for (let k = 0; k < ranked.length; k++) {
    const col = ranked[k], factor = Math.sqrt(Math.max(0, gram[index(n, col, col)]));
    for (let i = 0; i < n; i++) result[i][k] = vectors[index(n, i, col)] * factor;
    const pivot = result.reduce((best, row, i) => Math.abs(row[k]) > Math.abs(result[best][k]) ? i : best, 0);
    if (result[pivot][k] < 0) for (let i = 0; i < n; i++) result[i][k] *= -1;
  }
  const maxRadius = Math.max(...result.map(x => Math.hypot(...x)));
  if (maxRadius > 1e-12) for (const row of result) for (let k = 0; k < 3; k++) row[k] *= 4.5 / maxRadius;
  return result;
}

/** Silhouette in the original fused dissimilarity space; singleton score = zero. */
export function silhouetteScores(sim: Matrix, n: number, labels: number[]): number[] {
  const groups = new Map<number, number[]>();
  labels.forEach((label, i) => { const group = groups.get(label) ?? []; group.push(i); groups.set(label, group); });
  if (groups.size < 2) return Array(n).fill(0);
  return labels.map((label, i) => {
    const own = groups.get(label)!;
    if (own.length < 2) return 0;
    const a = own.reduce((sum, j) => sum + (i === j ? 0 : 1 - sim[index(n,i,j)]), 0) / (own.length - 1);
    let b = Infinity;
    for (const [other, members] of groups) if (other !== label) {
      b = Math.min(b, members.reduce((sum,j) => sum + 1 - sim[index(n,i,j)],0) / members.length);
    }
    return Math.max(a,b) > 1e-12 ? (b-a)/Math.max(a,b) : 0;
  });
}

function clusterGroups(sim: Matrix, n: number): { labels: number[]; silhouette: number | null } {
  if (n < 4 || !hasSignal(sim, n)) return { labels: Array(n).fill(0), silhouette: null };
  const groups = Array.from({ length: n }, (_, i) => [i]);
  const toLabels = () => {
    const labels = Array(n).fill(0);
    [...groups].sort((a,b) => b.length-a.length || a[0]-b[0]).forEach((g,k) => g.forEach(i => { labels[i]=k; }));
    return labels;
  };
  let bestLabels = Array(n).fill(0);
  let bestObjective = 0.02;
  let bestSilhouette: number | null = null;
  let bestGroupCount = 1;
  // A split requires positive evidence and at least two non-singleton groups.
  while (groups.length > 1) {
    if (groups.length <= 7 && groups.filter(g => g.length >= 2).length >= 2) {
      const labels = toLabels();
      const scores = silhouetteScores(sim, n, labels);
      const silhouette = scores.reduce((a, b) => a + b, 0) / n;
      const singletonFraction = groups.filter(g => g.length === 1).length / n;
      const tinyFraction = groups.filter(g => g.length <= 2).length / n;
      const countPenalty = groups.length > 4 ? 0.015 * (groups.length - 4) : 0;
      const objective = silhouette - 0.10 * singletonFraction - 0.04 * tinyFraction - countPenalty;
      if (
        objective > bestObjective + 1e-9 ||
        (Math.abs(objective - bestObjective) <= 1e-9 && groups.length < bestGroupCount)
      ) {
        bestObjective = objective;
        bestLabels = labels;
        bestSilhouette = silhouette;
        bestGroupCount = groups.length;
      }
    }
    let best = -Infinity, ga = 0, gb = 1;
    for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) {
      let sum = 0;
      for (const i of groups[a]) for (const j of groups[b]) sum += sim[index(n, i, j)];
      const score = sum / (groups[a].length * groups[b].length);
      if (score > best + 1e-12) { best = score; ga = a; gb = b; }
    }
    groups[ga] = groups[ga].concat(groups[gb]);
    groups.splice(gb, 1);
  }
  return { labels: bestLabels, silhouette: bestSilhouette };
}

export function buildMap(papers: PaperRecord[], weights: Weights): AnalysisResult {
  if (!papers.length) throw new Error('No papers supplied');
  const n = papers.length;
  const text = similarityText(papers);
  const structure = similarityStructure(papers);
  const components = { abstract: text, authors: structure.authors, citations: structure.citations };
  const available = { abstract: false, authors: false, citations: false };
  for (const name of Object.keys(components) as Array<keyof Weights>) {
    available[name] = hasSignal(components[name], n);
  }
  const active = {
    abstract: available.abstract ? Math.max(0, weights.abstract) : 0,
    authors: available.authors ? Math.max(0, weights.authors) : 0,
    citations: available.citations ? Math.max(0, weights.citations) : 0,
  };
  let total = active.abstract + active.authors + active.citations;
  if (!total) { active.abstract = 1; total = 1; }
  const combined = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    combined[index(n, i, i)] = 1;
    for (let j = i + 1; j < n; j++) {
      const p = index(n, i, j);
      const score = clamp((active.abstract * text[p] + active.authors * structure.authors[p] + active.citations * structure.citations[p]) / total);
      combined[p] = combined[index(n, j, i)] = score;
    }
  }
  const positions = hasSignal(combined, n) ? classicalMDS(combined, n) : Array.from({ length: n }, () => [0, 0, 0]);
  // Domain names should follow textual evidence when the fused network is too sparse.
  // The user-selected weights still control the MDS projection and edge strengths.
  let grouping = clusterGroups(combined, n);
  if (grouping.silhouette === null && active.abstract > 0 && available.abstract) {
    grouping = clusterGroups(text, n);
  }
  const labels = grouping.labels;
  const silhouette = grouping.silhouette === null ? null : silhouetteScores(combined,n,labels).reduce((a,b) => a+b,0)/n;
  const textSilhouette = silhouette === null ? null : silhouetteScores(text,n,labels).reduce((a,b) => a+b,0)/n;
  const points = papers.map((paper, i) => ({
    id: paper.id, x: Number(positions[i][0].toFixed(5)), y: Number(positions[i][1].toFixed(5)),
    z: Number(positions[i][2].toFixed(5)), cluster: labels[i],
    paper: { id: paper.id, title: paper.title, abstract: paper.abstract, year: paper.year,
      cited_by_count: paper.cited_by_count, authors: paper.authors, doi: paper.doi, url: paper.url },
  }));
  const citationUndirected = new Set(structure.citationPairs.map(([a, b]) => `${Math.min(a, b)}:${Math.max(a, b)}`));
  const edges: AnalysisResult['edges'] = structure.citationPairs.map(([i, j]) => ({
    source: papers[i].id, target: papers[j].id, kind: 'citation', strength: Number(combined[index(n, i, j)].toFixed(4)),
  }));
  const similar = new Map<string, [number, number, number]>();
  for (let i = 0; i < n; i++) {
    const nearest: Array<[number, number]> = [];
    for (let j = 0; j < n; j++) {
      if (i !== j && combined[index(n, i, j)] >= 0.015 && !citationUndirected.has(`${Math.min(i,j)}:${Math.max(i,j)}`)) nearest.push([j, combined[index(n, i, j)]]);
    }
    nearest.sort((a, b) => b[1] - a[1]);
    // Keep only positive, reasonably strong local neighbors, not invented links.
    for (const [j, score] of nearest.slice(0, 2).filter(([, score]) => score >= (nearest[0]?.[1] ?? 0) * 0.5)) {
      const a = Math.min(i, j), b = Math.max(i, j), key = `${a}:${b}`;
      if (!citationUndirected.has(key)) similar.set(key, [a, b, score]);
    }
  }
  for (const [i, j, strength] of [...similar.values()].sort((a, b) => b[2] - a[2]).slice(0, 240)) {
    edges.push({ source: papers[i].id, target: papers[j].id, kind: 'similarity', strength: Number(strength.toFixed(4)) });
  }
  return { points, edges, metrics: {
    topic_clustering: { version: 3, groups: new Set(labels).size, silhouette, text_silhouette: textSilhouette },
    papers: n, citation_links: structure.citationPairs.length,
    similarity_links: edges.filter(e => e.kind === 'similarity').length,
    unique_authors: new Set(papers.flatMap(p => p.author_ids)).size,
    available_signals: available,
    effective_weights: { abstract: active.abstract / total, authors: active.authors / total, citations: active.citations / total },
  } };
}
