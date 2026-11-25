/** Deterministic, browser-only multi-view similarity, classical MDS and grouping. */
import type { AnalysisResult, PaperRecord, Weights } from '../types';

type Matrix = Float64Array;
const STOPWORDS = new Set('a an the and or for nor to from in of on at by with without as is are was were be been that this these those not which we they it into using use used via based approach method study paper research between than can could may our their its new also over under when where how what show shows'.split(' '));
const index = (n: number, i: number, j: number) => i * n + j;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
  return matches.filter(t => !STOPWORDS.has(t));
}
function vectorize(papers: PaperRecord[]): Map<number, number>[] {
  const vocabulary = new Map<string, number>();
  const frequencies = new Map<number, number>();
  const counts: Map<number, number>[] = [];
  for (const paper of papers) {
    const words = tokenize(`${paper.title} ${paper.title} ${paper.abstract.slice(0, 7000)}`);
    const doc = new Map<number, number>();
    const tokens = [...words, ...words.slice(1).map((v, i) => `${words[i]}_${v}`)];
    for (const token of tokens) {
      if (!vocabulary.has(token)) vocabulary.set(token, vocabulary.size);
      const id = vocabulary.get(token)!;
      doc.set(id, (doc.get(id) || 0) + 1);
    }
    for (const key of doc.keys()) frequencies.set(key, (frequencies.get(key) || 0) + 1);
    counts.push(doc);
  }
  return counts.map(doc => {
    let magnitude = 0;
    const tfidf = new Map<number, number>();
    for (const [key, count] of doc) {
      const idf = 1 + Math.log((papers.length + 1) / ((frequencies.get(key) || 0) + 1));
      const value = (1 + Math.log(count)) * idf;
      tfidf.set(key, value);
      magnitude += value * value;
    }
    const norm = Math.sqrt(magnitude) || 1;
    for (const [key, value] of tfidf) tfidf.set(key, value / norm);
    return tfidf;
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
function normalize(matrix: Matrix, n: number): boolean {
  const positive: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const value = matrix[index(n, i, j)];
      if (value > 1e-12) positive.push(value);
    }
  }
  if (!positive.length) return false;
  positive.sort((a, b) => a - b);
  const position = (positive.length - 1) * 0.9;
  const lo = Math.floor(position), hi = Math.ceil(position);
  const divisor = positive[lo] * (hi - position) + positive[hi] * (position - lo) || positive[lo] || 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const score = clamp(matrix[index(n, i, j)] / divisor);
      matrix[index(n, i, j)] = matrix[index(n, j, i)] = score;
    }
  }
  return true;
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

function clusterGroups(sim: Matrix, n: number): number[] {
  if (n < 3) return Array(n).fill(0);
  const k = Math.min(7, Math.max(2, Math.floor(Math.sqrt(n) / 1.8) + 1), n - 1);
  const groups = Array.from({ length: n }, (_, i) => [i]);
  // Average-linkage hierarchical clustering, using fused similarity before projection.
  while (groups.length > k) {
    let best = -Infinity, ga = -1, gb = -1;
    for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) {
      let sum = 0;
      for (const i of groups[a]) for (const j of groups[b]) sum += sim[index(n, i, j)];
      const score = sum / (groups[a].length * groups[b].length);
      if (score > best + 1e-12) { best = score; ga = a; gb = b; }
    }
    groups[ga] = groups[ga].concat(groups[gb]);
    groups.splice(gb, 1);
  }
  // Label groups by population for stable colors and meaningful ordering.
  groups.sort((a, b) => b.length - a.length || a[0] - b[0]);
  const labels = Array(n).fill(0);
  groups.forEach((group, id) => group.forEach(i => { labels[i] = id; }));
  return labels;
}

export function buildMap(papers: PaperRecord[], weights: Weights): AnalysisResult {
  if (!papers.length) throw new Error('No papers supplied');
  const n = papers.length;
  const text = similarityText(papers);
  const structure = similarityStructure(papers);
  const components = { abstract: text, authors: structure.authors, citations: structure.citations };
  const available = { abstract: false, authors: false, citations: false };
  for (const name of Object.keys(components) as Array<keyof Weights>) {
    available[name] = normalize(components[name], n);
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
  const positions = classicalMDS(combined, n), labels = clusterGroups(combined, n);
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
      if (i !== j && combined[index(n, i, j)] >= 0.23) nearest.push([j, combined[index(n, i, j)]]);
    }
    nearest.sort((a, b) => b[1] - a[1]);
    for (const [j, score] of nearest.slice(0, 2)) {
      const a = Math.min(i, j), b = Math.max(i, j), key = `${a}:${b}`;
      if (!citationUndirected.has(key)) similar.set(key, [a, b, score]);
    }
  }
  for (const [i, j, strength] of [...similar.values()].sort((a, b) => b[2] - a[2]).slice(0, 240)) {
    edges.push({ source: papers[i].id, target: papers[j].id, kind: 'similarity', strength: Number(strength.toFixed(4)) });
  }
  return { points, edges, metrics: {
    papers: n, citation_links: structure.citationPairs.length,
    similarity_links: edges.filter(e => e.kind === 'similarity').length,
    unique_authors: new Set(papers.flatMap(p => p.author_ids)).size,
    available_signals: available,
    effective_weights: { abstract: active.abstract / total, authors: active.authors / total, citations: active.citations / total },
  } };
}
