import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegionLabels, choosePaperLabelIds } from '../src/lib/region-labels.ts';

const paper = (id, cluster, title, abstract, cites = 0, pos = 0) => ({
  id, cluster, x: pos, y: pos / 2, z: pos / 3,
  paper: {id, title, abstract, cited_by_count:cites, year:2025, authors:[],doi:null,url:''},
});
const points = [
  paper('W1', 0, 'Adversarial image patches', 'An adversarial patch attack fools image classifiers', 3, 1),
  paper('W2', 0, 'Patch robustness attacks', 'Adversarial patch attacks on vision classifiers', 10, 2),
  paper('W3', 0, 'Localized adversarial perturbations', 'Image patch security and localized attacks', 4, 3),
  paper('W4', 1, 'Molecular graph optimization', 'Chemical molecule search and graph optimization', 9, -1),
  paper('W5', 1, 'Graph chemistry molecules', 'Molecular property prediction in chemical graphs', 4, -2),
  paper('W6', 1, 'Chemical molecule properties', 'Predict chemical properties of molecular structures', 0, -3),
];

test('returns distinct, interpretable cluster descriptors at their centroids', () => {
  const actual = buildRegionLabels(points);
  assert.deepEqual(actual.map(x => x.paperCount), [3, 3]);
  assert.deepEqual(actual.map(x => x.cluster), [0, 1]);
  assert.equal(actual[0].x, 2);
  assert.equal(actual[1].x, -2);
  assert.ok(actual[0].keywords.length && actual[1].keywords.length);
  const joined = actual.map(x => x.keywords.join(' '));
  assert.match(joined[0], /adversarial|patch|attack|image|localized/);
  assert.match(joined[1], /molecul|chemical|graph|chemistry|property/);
  assert.equal(new Set(actual.flatMap(x => x.keywords)).size, actual.flatMap(x => x.keywords).length);
  assert.deepEqual(buildRegionLabels(points), actual);
});

test('handles empty, legacy, and sparse maps without divide-by-zero or invented terms', () => {
  assert.deepEqual(buildRegionLabels([]), []);
  const only = paper('one', 0, '', '', 2);
  assert.deepEqual(buildRegionLabels([only])[0].keywords, []);
  assert.ok(buildRegionLabels([only]).every(p => [p.x,p.y,p.z].every(Number.isFinite)));
});

test('label modes select only key papers, all papers, or no papers', () => {
  assert.deepEqual([...choosePaperLabelIds(points, 'off', 'W1')], []);
  assert.equal(choosePaperLabelIds(points, 'all', null).size, 6);
  const key = choosePaperLabelIds(points, 'key', 'W1');
  assert.ok(key.has('W2') && key.has('W4') && key.has('W1'));
  assert.equal(key.size, 5);
  assert.equal(choosePaperLabelIds(points.filter(x => x.cluster === 1), 'key', 'W1').size, 2);
});
