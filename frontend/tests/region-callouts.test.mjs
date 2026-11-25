import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegionClouds } from '../src/lib/clouds.ts';
import { buildRegionCallouts } from '../src/lib/region-callouts.ts';
const point = (cluster,x,y,z) => ({cluster,x,y,z});
test('callouts lie beyond every visible cloud vertex and paper in their outward direction',()=>{
  const points=[point(0,-2,0,0),point(0,-1,0.5,0),point(1,2,0,0),point(1,3,1,0),point(2,0,0,2)];
  const clouds=buildRegionClouds(points), calls=buildRegionCallouts(clouds,points);
  assert.equal(calls.length,3);
  for(const c of calls){
    const d=c.label.map((v,i)=>v-c.tip[i]);
    for(const cloud of clouds) for(let i=0;i<cloud.x.length;i++) {
      const p=[cloud.x[i],cloud.y[i],cloud.z[i]];
      assert.ok(p.reduce((s,v,i)=>s+(c.label[i]-v)*d[i],0)>0);
    }
    assert.equal(c.x.length,15); assert.deepEqual([c.x[0],c.y[0],c.z[0]],c.label);
    assert.deepEqual([c.x[1],c.y[1],c.z[1]],c.tip);
    assert.ok(clouds.find(g=>g.cluster===c.cluster).x.some((x,i)=>x===c.tip[0]&&clouds.find(g=>g.cluster===c.cluster).y[i]===c.tip[1]&&clouds.find(g=>g.cluster===c.cluster).z[i]===c.tip[2]));
  }
});
test('coincident clusters have distinct finite deterministic callouts; empty and filtered maps work',()=>{
  const points=[point(0,0,0,0),point(1,0,0,0),point(2,0,0,0)];
  const clouds=buildRegionClouds(points), calls=buildRegionCallouts(clouds,points);
  assert.equal(new Set(calls.map(c=>JSON.stringify(c.label))).size,3);
  assert.ok(calls.every(c=>[...c.label,...c.tip].every(Number.isFinite)));
  assert.deepEqual(calls,buildRegionCallouts(clouds,points));
  assert.deepEqual(buildRegionCallouts([],[]),[]);
  assert.equal(buildRegionCallouts(clouds.slice(0,1),points.slice(0,1)).length,1);
});
