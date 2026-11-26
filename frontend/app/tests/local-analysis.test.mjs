import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMap } from '../src/lib/analysis.ts';
import { decodeAbstract, fetchOpenAlex, makeOpenAlexURL, parseWork } from '../src/lib/openalex.ts';

const weights = { abstract: .65, authors: .15, citations: .20 };
const works = [
  { id: 'W100', title: 'Adversarial image patches', abstract: 'Explainability of visual patches', authors: [{ id:'A1', name:'Ada' }], author_ids:['A1'], referenced_works:['W200','W999'], url:'https://openalex.org/works/W100', doi:null, year:2023, cited_by_count:4 },
  { id: 'W200', title: 'Image perturbation interpretation', abstract: 'Explaining visual adversarial attacks', authors: [{ id:'A1', name:'Ada' }], author_ids:['A1'], referenced_works:['W999'], url:'https://openalex.org/works/W200', doi:null, year:2024, cited_by_count:8 },
  { id: 'W300', title: 'Tree search for molecular materials', abstract: 'Graph optimization with chemical experiments', authors: [{ id:'A3', name:'Grace' }], author_ids:['A3'], referenced_works:['W500'], url:'https://openalex.org/works/W300', doi:null, year:2020, cited_by_count:2 },
];
const raw = (i) => ({
  id: `https://openalex.org/W${i}`, title: `Paper ${i}`, abstract_inverted_index: { Hello:[0], World:[1] },
  authorships:[{author:{id:'https://openalex.org/A1',display_name:'Ada'}}],
  referenced_works:['https://openalex.org/W456'], doi: 'https://doi.org/10.1234/example',
});

test('reconstructs abstract in position order', () => {
  assert.equal(decodeAbstract({ world:[2], Hello:[0], 'beautiful':[1] }), 'Hello beautiful world');
  assert.equal(decodeAbstract(null), '');
});
test('normalizes OpenAlex author and cited-work IDs', () => {
  const paper = parseWork(raw(123));
  assert.equal(paper.id, 'W123');
  assert.deepEqual(paper.author_ids, ['A1']);
  assert.deepEqual(paper.referenced_works, ['W456']);
});
test('skips empty abstracts and invalid ids', () => {
  assert.equal(parseWork({ id:'W1' }), null);
  assert.equal(parseWork({ ...raw(123), id:'bad' }), null);
});
test('builds OpenAlex query with correct year filters, key, and page size', () => {
  const url = new URL(makeOpenAlexURL({ query:'adversarial patches', year_from:2018, year_to:2026, limit:120, weights }, 'my-secret-key', 2));
  assert.equal(url.origin, 'https://api.openalex.org');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('per_page'), '100');
  assert.equal(url.searchParams.get('api_key'), 'my-secret-key');
  assert.match(url.searchParams.get('filter'), /has_abstract:true/);
  assert.match(url.searchParams.get('filter'), /from_publication_date:2018-01-01/);
});
test('direct browser fetch sends no application backend request, handles multi-page and dedup', async () => {
  const urls = [];
  const fetcher = async (url, options) => {
    urls.push(url);
    assert.equal(options.mode, 'cors');
    return { ok:true, status:200, json:async () => ({ results: urls.length === 1
      ? Array.from({ length: 100 }, (_, i) => raw(i + 1))
      : [raw(1), ...Array.from({ length: 20 }, (_, i) => raw(i + 101))] }) };
  };
  const papers = await fetchOpenAlex({ query:'a topic', year_from:null, year_to:null, weights, limit:120 }, '', fetcher);
  assert.equal(papers.length, 120);
  assert.equal(urls.length, 2);
  assert.ok(urls.every(url => url.startsWith('https://api.openalex.org/works?')));
});
test('explicit API quota error is surfaced', async () => {
  await assert.rejects(fetchOpenAlex({ query:'a topic', year_from:null, year_to:null, weights, limit:20 }, '', async () => ({status:429,ok:false})), /quota or rate limit/i);
});
test('single-paper map is finite and has no edges', () => {
  const result = buildMap([works[0]], weights);
  assert.deepEqual(result.points.map(p => [p.x,p.y,p.z]), [[0,0,0]]);
  assert.equal(result.edges.length, 0);
});
test('citation edges point from citing to cited, with coupling and coauthors', () => {
  const result = buildMap(works, weights);
  assert.ok(result.edges.some(e => e.kind === 'citation' && e.source === 'W100' && e.target === 'W200'));
  assert.equal(result.metrics.citation_links, 1);
  assert.equal(result.metrics.unique_authors, 2);
  assert.equal(result.metrics.available_signals.authors, true);
});
test('weighted maps are deterministic but positions change when weights change', () => {
  const diversified = [...works,
    { ...works[0], id:'W400', title:'Adversarial image explanation', abstract:'Visual saliency explanation methods for adversarial patches', author_ids:['A4'], authors:[{id:'A4',name:'Charles'}], referenced_works:['W999'] },
    { ...works[2], id:'W500', title:'Molecular optimization graph theory', author_ids:['A5'], authors:[{id:'A5',name:'Lin'}], referenced_works:['W500'] },
  ];
  const baseline = buildMap(diversified, weights);
  const duplicate = buildMap(diversified, weights);
  assert.deepEqual(baseline, duplicate);
  const alternate = buildMap(diversified, { abstract:0, authors:1, citations:0 });
  assert.notDeepEqual(baseline.points.map(p => [p.x,p.y,p.z]), alternate.points.map(p => [p.x,p.y,p.z]));
  assert.equal(alternate.metrics.effective_weights.authors, 1);
});
test('3d coordinates remain finite, with at most 7 groups for 120 papers', () => {
  const large = Array.from({length:120}, (_, i) => ({ ...works[i % 3], id:`W${i + 10000}`,
    title: `${works[i % 3].title} ${i}`, referenced_works:[] }));
  const result = buildMap(large, weights);
  assert.equal(result.points.length, 120);
  assert.ok(result.points.every(p => [p.x,p.y,p.z].every(Number.isFinite)));
  assert.ok(new Set(result.points.map(p => p.cluster)).size <= 7);
});
