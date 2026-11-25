import { fetchOpenAlex } from './lib/openalex';
import { readLocal, writeLocal } from './lib/storage';
import type { AnalysisResult, MapData, PaperRecord, SearchInput, Weights } from './types';

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_IMPORT_BYTES = 15_000_000;
type CachedSearch = { savedAt: number; papers: PaperRecord[] };
type StoredMap = { map: MapData; papers: PaperRecord[] };
let jobId = 0;

function createId() {
  return crypto.randomUUID();
}
function searchKey(input: SearchInput) {
  return JSON.stringify([input.query.trim().toLowerCase().replace(/\s+/g, ' '), input.year_from, input.year_to, input.limit]);
}
function validateWeights(weights: Weights) {
  if (!Object.values(weights).some(w => w > 0)) throw new Error('少なくとも1つの類似度の重みを設定してください。');
}

/** Analysis is offloaded to a Web Worker; never POSTs papers to FastAPI. */
export function analyzeInWorker(papers: PaperRecord[], weights: Weights): Promise<AnalysisResult> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') { reject(new Error('Web Workerに対応したブラウザが必要です。')); return; }
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    const id = ++jobId;
    worker.onmessage = (event: MessageEvent<{ id: number; data?: AnalysisResult; error?: string }>) => {
      if (event.data.id !== id) return;
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else if (event.data.data) resolve(event.data.data);
      else reject(new Error('分析ワーカーの応答が不正です。'));
    };
    worker.onerror = () => { worker.terminate(); reject(new Error('ローカル分析ワーカーが失敗しました。')); };
    worker.postMessage({ id, papers, weights });
  });
}

export async function createMap(
  input: SearchInput,
  options: { apiKey?: string; onProgress?: (message: string) => void } = {},
): Promise<MapData> {
  validateWeights(input.weights);
  const cachedSearch = await readLocal<CachedSearch>('searches', searchKey(input));
  let papers: PaperRecord[];
  let cached = false, stale = false;
  if (cachedSearch && Date.now() - cachedSearch.savedAt <= TTL_MS && cachedSearch.papers.length) {
    papers = cachedSearch.papers;
    cached = true;
    options.onProgress?.('IndexedDBの検索キャッシュを利用しています');
  } else {
    try {
      papers = await fetchOpenAlex(input, options.apiKey, fetch, options.onProgress);
      await writeLocal('searches', searchKey(input), { savedAt: Date.now(), papers } satisfies CachedSearch);
    } catch (error) {
      if (!cachedSearch?.papers.length) throw error;
      papers = cachedSearch.papers;
      cached = true;
      stale = true;
      options.onProgress?.('OpenAlexに接続できないため、古いキャッシュを利用しています');
    }
  }
  options.onProgress?.('ブラウザ内で類似度と3D配置を計算中');
  const analysis = await analyzeInWorker(papers, input.weights);
  const map: MapData = {
    ...analysis, id: createId(), query: input.query.trim(), year_from: input.year_from,
    year_to: input.year_to, requested_limit: input.limit, weights: { ...input.weights },
    created_at: new Date().toISOString(), cached, embedding_method: 'tfidf-browser',
  };
  map.metrics.stale_provider_fallback = stale;
  await writeLocal('maps', map.id, { map, papers } satisfies StoredMap);
  return map;
}

export async function loadMap(id: string): Promise<MapData> {
  const saved = await readLocal<StoredMap>('maps', id);
  if (!saved) throw new Error('このマップは現在のブラウザに保存されていません。別の端末へはJSONを書き出して移動してください。');
  return { ...saved.map, cached: true };
}

export async function reweightMap(id: string, weights: Weights): Promise<MapData> {
  validateWeights(weights);
  const saved = await readLocal<StoredMap>('maps', id);
  if (!saved?.papers.length) throw new Error('ローカルに元論文がありません。');
  const analysis = await analyzeInWorker(saved.papers, weights);
  const map: MapData = { ...saved.map, ...analysis, weights: { ...weights }, cached: true };
  await writeLocal('maps', id, { map, papers: saved.papers } satisfies StoredMap);
  return map;
}

export async function exportMap(id: string): Promise<Blob> {
  const saved = await readLocal<StoredMap>('maps', id);
  if (!saved) throw new Error('エクスポートするマップが見つかりません。');
  return new Blob([JSON.stringify({ version: 1, query: saved.map.query,
    requested_limit: saved.map.requested_limit, year_from: saved.map.year_from,
    year_to: saved.map.year_to, weights: saved.map.weights, papers: saved.papers }, null, 2)],
    { type: 'application/json' });
}

/** Import source papers, then rebuild coordinates; do not trust arbitrary persisted map edges/URLs. */
export async function importMap(file: File): Promise<MapData> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('JSONファイルが大きすぎます（上限15MB）。');
  let parsed: unknown;
  try { parsed = JSON.parse(await file.text()); } catch { throw new Error('JSONファイルを読み込めませんでした。'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('JSONの形式が正しくありません。');
  const value = parsed as Record<string, unknown>;
  if (value.version !== 1 || typeof value.query !== 'string' || !Array.isArray(value.papers) || value.papers.length < 1 || value.papers.length > 120) {
    throw new Error('Research Map形式のJSONではありません（最大120件）。');
  }
  const w = value.weights as Weights;
  if (!w || !(['abstract', 'authors', 'citations'] as const).every(k => typeof w[k] === 'number' && Number.isFinite(w[k]) && w[k] >= 0 && w[k] <= 1)) {
    throw new Error('重みの値が不正です。');
  }
  validateWeights(w);
  const papers: PaperRecord[] = value.papers.map((p: unknown) => {
    if (!p || typeof p !== 'object') throw new Error('論文データが不正です。');
    const r = p as Record<string, unknown>;
    if (typeof r.id !== 'string' || !/^W\d+$/.test(r.id) || typeof r.title !== 'string' || typeof r.abstract !== 'string' ||
      !Array.isArray(r.authors) || !Array.isArray(r.author_ids) || !Array.isArray(r.referenced_works)) {
      throw new Error('論文データの必須フィールドがありません。');
    }
    return {
      id: r.id, title: r.title.slice(0, 2000), abstract: r.abstract.slice(0, 20000),
      year: typeof r.year === 'number' && Number.isInteger(r.year) ? r.year : null,
      cited_by_count: typeof r.cited_by_count === 'number' && Number.isFinite(r.cited_by_count) ? Math.max(0, r.cited_by_count) : 0,
      authors: (r.authors as unknown[]).filter(a => a && typeof a === 'object')
        .slice(0, 100).map(a => { const author = a as Record<string, unknown>;
          return { id: typeof author.id === 'string' ? author.id.slice(0, 32) : '',
            name: typeof author.name === 'string' ? author.name.slice(0, 200) : '' }; }),
      author_ids: (r.author_ids as unknown[]).filter((id): id is string => typeof id === 'string' && /^A\d+$/.test(id)).slice(0, 100),
      referenced_works: (r.referenced_works as unknown[]).filter((id): id is string => typeof id === 'string' && /^W\d+$/.test(id)).slice(0, 2000),
      doi: typeof r.doi === 'string' && /^https:\/\//.test(r.doi) ? r.doi : null,
      url: `https://openalex.org/${r.id}`,
    };
  });
  const analysis = await analyzeInWorker(papers, w);
  const map: MapData = {
    ...analysis, id: createId(), query: value.query.slice(0, 200),
    year_from: typeof value.year_from === 'number' ? value.year_from : null,
    year_to: typeof value.year_to === 'number' ? value.year_to : null,
    requested_limit: papers.length, weights: { ...w }, cached: true,
    embedding_method: 'tfidf-browser', created_at: new Date().toISOString(),
  };
  await writeLocal('maps', map.id, { map, papers } satisfies StoredMap);
  return map;
}
