import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegionClouds } from '../src/lib/clouds.ts';
const p = (id, cluster, x, y, z) => ({id, cluster, x, y, z,
  paper: {id, title: 'sample', abstract: '', year: 2024, cited_by_count: 0, authors: [], doi: null, url: ''}});

test('clouds are grouped by area with finite closed mesh', () => {
  const clouds = buildRegionClouds([p('a', 3, -1, 0, 0), p('b', 3, 1, 0, 0), p('c', 8, 2, 3, 1)]);
  assert.deepEqual(clouds.map(c => c.cluster), [3, 8]);
  assert.equal(clouds[0].count, 2);
  assert.deepEqual(clouds[0].center, [0, 0, 0]);
  assert.ok(clouds[0].radii[0] > clouds[0].radii[1]);
  for (const cloud of clouds) {
    assert.equal(cloud.x.length, 198);
    assert.equal(cloud.i.length, 360);
    assert.ok([...cloud.x, ...cloud.y, ...cloud.z].every(Number.isFinite));
    assert.ok([...cloud.i, ...cloud.j, ...cloud.k].every(n => Number.isInteger(n) && n >= 0 && n < cloud.x.length));
  }
});

test('empty, singleton and degenerate regions are safe', () => {
  assert.deepEqual(buildRegionClouds([]), []);
  const a = buildRegionClouds([p('one', 0, 5, -3, 2)]);
  assert.deepEqual(a[0].center, [5, -3, 2]);
  assert.ok(a[0].radii.every(v => v > 0));
  const b = buildRegionClouds([p('a', 0, 3, 3, 3), p('b', 0, 3, 3, 3)]);
  assert.ok(b[0].x.every(Number.isFinite));
});

test('orientation tracks the spatial direction, not fixed xyz axes', () => {
  const xCloud = buildRegionClouds([p('a', 0, -2, 0, 0), p('b', 0, 2, 0, 0)])[0];
  const yCloud = buildRegionClouds([p('a', 0, 0, -2, 0), p('b', 0, 0, 2, 0)])[0];
  const range = arr => Math.max(...arr) - Math.min(...arr);
  assert.ok(range(xCloud.x) > range(xCloud.y) * 2);
  assert.ok(range(yCloud.y) > range(yCloud.x) * 2);
});
