import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMap, silhouetteScores } from '../src/lib/analysis.ts';
import { buildRegionLabels } from '../src/lib/region-labels.ts';
import { technicalTerms } from '../src/lib/technical-terms.ts';
const paper = (id,title,abstract,author='') => ({id,title,abstract,authors:[],author_ids:author?[author]:[],referenced_works:[],year:2025,cited_by_count:0,doi:null,url:''});
const boiler = 'This study presents a novel effective method and demonstrates significant improvements in performance. We report experimental results and propose a framework.';
const corpus = ['integrated gradients','adversarial patch','natural evolution strategies'].flatMap((term,g) => Array.from({length:5},(_,i)=>paper(`W${g*5+i}`, `${term} ${['in practice','for benchmarks','with sensitivity','for validation','in experiments'][i]}`, `${boiler} ${term} ${term}.`)));
const w = {abstract:.65,authors:.15,citations:.2};
test('technical phrases remain adjacent and academic filler is excluded',()=>{
  const terms=technicalTerms('A novel approach. Adversarial examples with PGD. Large language model. Integrated gradients. Patch attacks.');
  for (const x of ['adversarial examples','pgd','large language model','integrated gradients','patch attacks']) assert.ok(terms.has(x),x);
  for (const x of ['novel','approach','examples pgd','pgd large','gradients patch']) assert.ok(!terms.has(x),x);
});
test('known three technical topics are recovered despite identical academic boilerplate',()=>{
  const r=buildMap(corpus,w);
  assert.equal(r.metrics.topic_clustering.groups,3);
  assert.ok(r.metrics.topic_clustering.silhouette>.8);
  for(let g=0;g<3;g++) assert.equal(new Set(r.points.slice(g*5,g*5+5).map(x=>x.cluster)).size,1);
  const regions=buildRegionLabels(r.points);
  assert.equal(regions.length,3);
  for(const phrase of ['integrated gradients','adversarial patch','natural evolution strategies']) assert.ok(regions.some(r=>r.keywords.some(k=>k===phrase||phrase.includes(k)&&k.includes(' '))), JSON.stringify(regions));
});
test('no evidence does not force colored topics or invent geometry',()=>{
  const r=buildMap(Array.from({length:12},(_,i)=>paper(`W${i}`,'A study',boiler)),w);
  assert.equal(r.metrics.topic_clustering.groups,1);
  assert.equal(r.metrics.topic_clustering.silhouette,null);
  assert.ok(r.points.every(p=>p.x===0&&p.y===0&&p.z===0));
  assert.deepEqual(buildRegionLabels(r.points)[0].keywords,[]);
});
test('single-paper anomalies and terms shared by all clusters are not captions',()=>{
  const points=Array.from({length:6},(_,i)=>({id:`W${i}`,cluster:i<3?0:1,x:i,y:0,z:0,paper:paper(`W${i}`, i===0?'unicorn spectral':'A study',boiler+' universal benchmark')}));
  assert.ok(buildRegionLabels(points).every(r=>r.keywords.length===0));
});
test('silhouette is positive for separated groups, negative for mixed groups, zero for singleton',()=>{
  const sim=Float64Array.from([1,.9,.1,.1,.9,1,.1,.1,.1,.1,1,.9,.1,.1,.9,1]);
  assert.ok(silhouetteScores(sim,4,[0,0,1,1]).every(s=>s>.8));
  assert.ok(silhouetteScores(sim,4,[0,1,0,1]).every(s=>s<0));
  assert.equal(silhouetteScores(sim,4,[0,1,1,1])[0],0);
});
