import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMap } from '../src/lib/analysis.ts';
import { buildRegionLabels, regionCaption } from '../src/lib/region-labels.ts';
const p = (i,title,abstract,author_ids=[]) => ({id:`W${i}`,title,abstract,author_ids,referenced_works:[],authors:[],year:2025,cited_by_count:0,doi:null,url:''});
const w = {abstract:.8,authors:.8,citations:.85};
test('single region with repeated title evidence gets a concrete caption',()=>{
  const points = Array.from({length:5},(_,i)=>({id:`W${i}`,cluster:0,x:0,y:0,z:0,paper:p(i,'Adversarial patch attacks','Adversarial patch attacks on vision')}));
  const [r] = buildRegionLabels(points);
  assert.match(regionCaption(r), /Adversarial Patch|Patch Attacks/i);
});
test('isolated titles cannot become a domain label',()=>{
  const points = [p(0,'Quantum teleportation',''),p(1,'Molecular docking','')].map((paper,i)=>({id:paper.id,cluster:i,x:0,y:0,z:0,paper}));
  assert.ok(buildRegionLabels(points).every(r=>r.keywords.length===0));
});
test('weak fused evidence retains real similarity links without inventing zero-score links',()=>{
  const papers = [p(0,'Adversarial patch attacks','Adversarial patch attacks localized vision', ['A']),p(1,'Adversarial patch attacks','Adversarial patch attacks perturbation', ['B']),p(2,'Molecular docking','Molecular docking chemistry',['A']),p(3,'Molecular docking','Molecular docking chemistry',['C'])];
  const r=buildMap(papers,w);
  assert.ok(r.edges.some(e=>e.kind==='similarity'&&e.source==='W0'&&e.target==='W1'));
  assert.ok(r.edges.every(e=>e.kind!=='similarity'||e.strength>0));
  assert.equal(r.metrics.topic_clustering.version,3);
});
