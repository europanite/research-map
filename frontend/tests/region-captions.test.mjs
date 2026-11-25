import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegionLabels, regionCaption } from '../src/lib/region-labels.ts';

const paper = (id, cluster, title, abstract) => ({
  id, cluster, x: cluster * 2, y: 0, z: 1,
  paper: {id, title, abstract, cited_by_count:3, year:2025, authors:[],doi:null,url:''},
});

test('region captions describe distinct terms for different colored regions', () => {
  const regions = buildRegionLabels([
    paper('W1',0,'Adversarial patch attacks','Localized adversarial vision patches'),
    paper('W2',0,'Adversarial vision perturbations','Image adversarial attacks against classifiers'),
    paper('W3',1,'Molecular graph chemistry','Molecular property prediction using chemical graphs'),
    paper('W4',1,'Chemical molecular structure','Graph property optimization for molecules'),
  ]);
  assert.equal(regions.length, 2);
  assert.ok(regions.every(r => r.keywords.length > 0));
  assert.notEqual(regionCaption(regions[0]), regionCaption(regions[1]));
  assert.equal(new Set(regions.flatMap(r => r.keywords)).size, regions.reduce((n,r) => n+r.keywords.length, 0));
  assert.equal(regionCaption(regions[0]), regionCaption(regions[0]));
});

test('sparse clusters disclose when no meaningful caption can be extracted', () => {
  assert.equal(regionCaption({cluster: 2, keywords:[]}), 'Group 3 (keywords unavailable)');
  assert.equal(regionCaption({cluster: 2, keywords:[' patch ','patch','attack']}), 'patch · attack');
});
