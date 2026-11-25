import { buildMap } from './lib/analysis';
import type { PaperRecord, Weights } from './types';

self.onmessage = (event: MessageEvent<{ id: number; papers: PaperRecord[]; weights: Weights }>) => {
  const { id, papers, weights } = event.data;
  try { self.postMessage({ id, data: buildMap(papers, weights) }); }
  catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};
