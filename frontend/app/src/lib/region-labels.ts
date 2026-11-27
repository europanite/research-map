/** Client-only, contrastive descriptors for the existing 3D paper clusters.
 * Scores phrases appearing repeatedly inside a cluster but rarely outside it.
 * Does not imply causal topic modeling: labels are descriptive approximations.
 */
import type { MapPoint } from '../types';
import { technicalTerms } from './technical-terms.ts';

export interface RegionLabel {
  cluster: number;
  keywords: string[];
  label: string;
  x: number;
  y: number;
  z: number;
  paperCount: number;
}

function terms(source: string): Set<string> { return new Set(technicalTerms(source).keys()); }

interface Candidate { term: string; score: number; count: number }

const ACRONYMS = new Set(['ai', 'xai', 'llm', 'nlp', 'cnn', 'rnn', 'gnn', 'gan', 'vit', 'bert', 'gpt', 'svm']);

function distinctTerms(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values.map(v => v.trim()).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function formatLabelTerm(term: string): string {
  return term.split(/\s+/).map(token => {
    const lower = token.toLowerCase();
    if (ACRONYMS.has(lower)) return lower.toUpperCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ');
}

function buildHumanLabel(keywords: string[], cluster: number): string {
  const chosen = distinctTerms(keywords).map(formatLabelTerm).slice(0, 2);
  return chosen.length ? chosen.join(' · ') : `Group ${cluster + 1} (keywords unavailable)`;
}

/** Works on maps previously saved in IndexedDB or exported as JSON. */
export function buildRegionLabels(points: MapPoint[]): RegionLabel[] {
  if (!points.length) return [];
  const groups = new Map<number, MapPoint[]>();
  for (const p of points) groups.set(p.cluster, [...(groups.get(p.cluster) ?? []), p]);
  const globalDf = new Map<string, number>();
  const groupDf = new Map<number, Map<string, number>>();
  const groupTitleDf = new Map<number, Map<string, number>>();

  for (const [cluster, papers] of groups) {
    const df = new Map<string, number>(), titleDf = new Map<string, number>();
    for (const { paper } of papers) {
      const titleTerms = terms(paper.title || '');
      const docTerms = new Set([...titleTerms, ...terms((paper.abstract || '').slice(0, 7000))]);
      for (const term of docTerms) {
        df.set(term, (df.get(term) ?? 0) + 1);
        globalDf.set(term, (globalDf.get(term) ?? 0) + 1);
      }
      for (const term of titleTerms) titleDf.set(term, (titleDf.get(term) ?? 0) + 1);
    }
    groupDf.set(cluster, df);
    groupTitleDf.set(cluster, titleDf);
  }

  const ranking = new Map<number, Candidate[]>();
  const size = points.length;
  for (const [cluster, papers] of groups) {
    const inside = papers.length, outside = size - inside;
    const minCount = Math.max(2, Math.ceil(inside * 0.20));
    const candidates: Candidate[] = [];
    const df = groupDf.get(cluster)!;
    const titleDf = groupTitleDf.get(cluster)!;
    for (const [term, count] of df) {
      if (count < minCount) continue;
      const otherCount = (globalDf.get(term) ?? 0) - count;
      const inRate = count / inside;
      const outRate = outside ? otherCount / outside : 0;
      if (outside && (inRate - outRate < 0.15 || inRate < 2 * outRate)) continue;
      if (outside && (globalDf.get(term) ?? 0) / size >= 0.75) continue;
      const titleCount = titleDf.get(term) ?? 0;
      const phrase = term.includes(' ');
      // In a single region, use a repeated title phrase as a corpus descriptor,
      // not a purported contrastive keyword or a single-paper title.
      if (!outside && (!phrase || titleCount < 2)) continue;
      if (!titleCount && (!phrase || inRate < 0.5)) continue;
      const contrast = outside ? Math.log((inRate + 0.05) / (outRate + 0.05)) : 1;
      const specificity = count / Math.max(1, globalDf.get(term) ?? 1);
      const phraseBonus = phrase ? (term.split(' ').length === 2 ? 2.5 : 2.1) : 0.8;
      const score = inRate * contrast * specificity * (1 + titleCount / inside) * phraseBonus;
      candidates.push({ term, score, count });
    }
    candidates.sort((a, b) => b.score - a.score || b.count - a.count || a.term.localeCompare(b.term));
    ranking.set(cluster, candidates);
  }

  // Pick one best unique term per cluster first, then a second descriptor.
  const chosen = new Map<number, string[]>();
  const used = new Set<string>();
  const order = [...groups.keys()].sort((a, b) =>
    (ranking.get(b)?.[0]?.score ?? 0) - (ranking.get(a)?.[0]?.score ?? 0) || a - b);
  for (const c of groups.keys()) chosen.set(c, []);
  for (let pass = 0; pass < 2; pass++) {
    for (const cluster of order) {
      const own = chosen.get(cluster)!;
      const candidate = (ranking.get(cluster) ?? []).find(({ term }) => {
        if (used.has(term)) return false;
        const fragments = term.split(' ');
        return !own.some(previous => previous.split(' ').some(fragment => fragments.includes(fragment)));
      });
      if (candidate) { own.push(candidate.term); used.add(candidate.term); }
    }
  }

  return [...groups.entries()].sort(([a], [b]) => a - b).map(([cluster, papers]) => {
    const keywords = distinctTerms(chosen.get(cluster) ?? []).slice(0, 2);
    return {
      cluster,
      keywords,
      label: buildHumanLabel(keywords, cluster),
      x: papers.reduce((s, p) => s + p.x, 0) / papers.length,
      y: papers.reduce((s, p) => s + p.y, 0) / papers.length,
      z: papers.reduce((s, p) => s + p.z, 0) / papers.length + 0.27,
      paperCount: papers.length,
    };
  });
}

export type PaperLabelMode = 'off' | 'key' | 'all';

/** IDs selected for short paper-title labels. Always keep selection when labels are active. */
export function choosePaperLabelIds(points: MapPoint[], mode: PaperLabelMode, selectedId: string | null): Set<string> {
  if (mode === 'off') return new Set();
  if (mode === 'all') return new Set(points.map(p => p.id));
  const perGroup = new Map<number, MapPoint[]>();
  for (const p of points) perGroup.set(p.cluster, [...(perGroup.get(p.cluster) ?? []), p]);
  const ids = new Set<string>();
  for (const group of perGroup.values()) {
    group.sort((a, b) => b.paper.cited_by_count - a.paper.cited_by_count ||
      (b.paper.year ?? 0) - (a.paper.year ?? 0) || a.id.localeCompare(b.id));
    for (const p of group.slice(0, 2)) ids.add(p.id);
  }
  if (selectedId && points.some(p => p.id === selectedId)) ids.add(selectedId);
  return ids;
}

/** Human-readable, group-specific caption used consistently across the map UI. */
export function regionCaption(region: Pick<RegionLabel, 'cluster' | 'keywords'> & Partial<Pick<RegionLabel, 'label'>>): string {
  const chosen = distinctTerms(region.keywords ?? []).slice(0, 2);
  if (!chosen.length) return `Group ${region.cluster + 1} (keywords unavailable)`;
  return region.label?.trim() || chosen.join(' · ');
}
