/** Client-only, contrastive descriptors for the existing 3D paper clusters.
 * Scores phrases appearing repeatedly inside a cluster but rarely outside it.
 * Does not imply causal topic modeling: labels are descriptive approximations.
 */
import type { MapPoint } from '../types';

export interface RegionLabel {
  cluster: number;
  keywords: string[];
  x: number;
  y: number;
  z: number;
  paperCount: number;
}

const STOP = new Set(`a an and are as at be been between by can could did do does for from has have how if in into is it its may more most not of on or our over per research results result show shows shown studies study such than that the their these this those through to using used use via was were what when which while who will with within without would your
  analysis analyses approaches approach based basic best better data datasets dataset deep different effect effects evaluation experiments experiment findings first framework general high human important improved information introduction investigating investigation large learning machine method methods model models new novel number obtained paper papers performance previous proposed proposes proposing propose recent related research researchers results review robust science several simple significant specific state system systems technique techniques test testing trained training various work works
  figure table section et al etc overall furthermore therefore however network networks neural algorithm algorithms artificial intelligence`.split(/\s+/));

function terms(source: string): Set<string> {
  const tokens = (source.toLowerCase().match(/[\p{L}][\p{L}\p{N}-]{1,}/gu) ?? [])
    .map(x => x.replace(/^-+|-+$/g, ''));
  const useful = (word: string) => word.length >= 3 && word.length <= 25 &&
    !STOP.has(word) && !/^\d/.test(word);
  const result = new Set(tokens.filter(useful));
  // Only real adjacent phrases, never pairs stitched across removed stopwords.
  for (let i = 0; i + 1 < tokens.length; i++) {
    const a = tokens[i], b = tokens[i + 1];
    if (useful(a) && useful(b) && a !== b) result.add(`${a} ${b}`);
  }
  return result;
}

interface Candidate { term: string; score: number }

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
    for (const {paper} of papers) {
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
    const minCount = inside >= 5 ? 2 : 1;
    const candidates: Candidate[] = [];
    for (const [term, count] of groupDf.get(cluster)!) {
      if (count < minCount) continue;
      const otherCount = (globalDf.get(term) ?? 0) - count;
      const inRate = count / inside;
      const outRate = outside ? otherCount / outside : 0;
      // Distinctiveness, not simply word frequency. Reject mostly-global words.
      const contrast = Math.log1p((inRate + 0.02) / (outRate + 0.05));
      const distinctiveness = 1 - otherCount / Math.max(1, globalDf.get(term) ?? 1);
      const titleFrequency = (groupTitleDf.get(cluster)?.get(term) ?? 0) / inside;
      const phraseBonus = term.includes(' ') ? 1.28 : 1;
      const score = inRate * contrast * (0.55 + 0.45 * distinctiveness) *
        (1 + 0.6 * titleFrequency) * phraseBonus;
      candidates.push({term, score});
    }
    candidates.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
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
      const candidate = (ranking.get(cluster) ?? []).find(({term}) => {
        if (used.has(term)) return false;
        const fragments = term.split(' ');
        return !own.some(previous => previous.split(' ').some(fragment => fragments.includes(fragment)));
      });
      if (candidate) { own.push(candidate.term); used.add(candidate.term); }
    }
  }

  return [...groups.entries()].sort(([a], [b]) => a - b).map(([cluster, papers]) => ({
    cluster,
    keywords: chosen.get(cluster) ?? [],
    x: papers.reduce((s, p) => s + p.x, 0) / papers.length,
    y: papers.reduce((s, p) => s + p.y, 0) / papers.length,
    // Small lift avoids covering central paper markers.
    z: papers.reduce((s, p) => s + p.z, 0) / papers.length + 0.27,
    paperCount: papers.length,
  }));
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
export function regionCaption(region: Pick<RegionLabel, 'cluster' | 'keywords'>): string {
  const chosen = [...new Set((region.keywords ?? []).map(x => x.trim()).filter(Boolean))].slice(0, 2);
  return chosen.length ? chosen.join(' · ') : `Group ${region.cluster + 1} (keywords unavailable)`;
}
