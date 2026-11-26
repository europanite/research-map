import type { PaperRecord, SearchInput } from '../types';

export const OPENALEX_URL = 'https://api.openalex.org/works';
const SELECT = 'id,title,display_name,publication_year,cited_by_count,authorships,referenced_works,abstract_inverted_index,doi';

type RawWork = {
  id?: string; title?: string; display_name?: string; publication_year?: number;
  cited_by_count?: number; doi?: string | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  authorships?: Array<{ author?: { id?: string; display_name?: string } }>;
  referenced_works?: string[];
};

export const normalizeId = (value: string | undefined | null): string => (value || '').replace(/\/$/, '').split('/').pop() || '';

export function decodeAbstract(inverted: Record<string, number[]> | null | undefined): string {
  if (!inverted || typeof inverted !== 'object') return '';
  const tokens: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(inverted)) {
    if (!Array.isArray(positions)) continue;
    for (const index of positions) {
      if (Number.isInteger(index) && index >= 0 && index < 100000) tokens.push([index, word]);
    }
  }
  tokens.sort((a, b) => a[0] - b[0]);
  return tokens.map(([, word]) => word).join(' ');
}

export function parseWork(raw: RawWork): PaperRecord | null {
  const id = normalizeId(raw.id);
  const abstract = decodeAbstract(raw.abstract_inverted_index);
  if (!/^W\d+$/.test(id) || !abstract.trim()) return null;
  const authors = (raw.authorships || []).filter(item => item?.author?.display_name).map(item => ({
    id: normalizeId(item.author?.id), name: item.author!.display_name!,
  }));
  const doi = typeof raw.doi === 'string' && /^https:\/\//i.test(raw.doi) ? raw.doi : null;
  return {
    id, title: raw.title || raw.display_name || 'Untitled', abstract,
    year: Number.isInteger(raw.publication_year) ? raw.publication_year! : null,
    cited_by_count: typeof raw.cited_by_count === 'number' ? Math.max(0, raw.cited_by_count) : 0,
    authors, author_ids: [...new Set(authors.map(a => a.id).filter(Boolean))],
    referenced_works: [...new Set((raw.referenced_works || []).map(normalizeId).filter(v => /^W\d+$/.test(v)))],
    doi, url: `https://openalex.org/${id}`,
  };
}

export function makeOpenAlexURL(input: SearchInput, apiKey: string, page: number): string {
  const filters = ['has_abstract:true'];
  if (input.year_from) filters.push(`from_publication_date:${input.year_from}-01-01`);
  if (input.year_to) filters.push(`to_publication_date:${input.year_to}-12-31`);
  const params = new URLSearchParams({
    search: input.query.trim(), filter: filters.join(','),
    sort: 'relevance_score:desc', per_page: String(Math.min(input.limit, 100)),
    page: String(page), select: SELECT,
  });
  if (apiKey.trim()) params.set('api_key', apiKey.trim());
  return `${OPENALEX_URL}?${params.toString()}`;
}

/** Browser -> OpenAlex directly. No proxy and no app backend. */
export async function fetchOpenAlex(
  input: SearchInput, apiKey = '',
  fetcher: typeof fetch = fetch,
  onProgress?: (message: string) => void,
): Promise<PaperRecord[]> {
  const result: PaperRecord[] = [];
  const seen = new Set<string>();
  const pages = Math.ceil(input.limit / Math.min(input.limit, 100));
  for (let page = 1; page <= pages; page++) {
    onProgress?.(`Fetching OpenAlex (${page}/${pages})`);
    let response: Response;
    try {
      response = await fetcher(makeOpenAlexURL(input, apiKey, page), {
        method: 'GET', credentials: 'omit', mode: 'cors',
        headers: { Accept: 'application/json' },
      });
    } catch {
      throw new Error('Could not reach OpenAlex. Check your network or browser CORS settings.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('OpenAlex denied access. Check your API key and pagination permissions.');
    }
    if (response.status === 429 || response.status === 402) {
      throw new Error('OpenAlex quota or rate limit reached. Use an API key or retry later.');
    }
    if (!response.ok) throw new Error(`OpenAlex HTTP ${response.status}. Check your search settings.`);
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new Error('OpenAlex returned invalid JSON.'); }
    if (!payload || typeof payload !== 'object' || !('results' in payload) || !Array.isArray(payload.results)) {
      throw new Error('OpenAlex response is missing results.');
    }
    for (const raw of payload.results as RawWork[]) {
      const paper = parseWork(raw);
      if (paper && !seen.has(paper.id)) {
        result.push(paper); seen.add(paper.id);
        if (result.length >= input.limit) break;
      }
    }
    if (result.length >= input.limit || payload.results.length < Math.min(input.limit, 100)) break;
  }
  if (!result.length) throw new Error('No papers with abstracts found. Try another query.');
  return result;
}
