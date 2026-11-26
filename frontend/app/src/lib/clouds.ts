/** Approximate translucent 3D regions for the existing MDS projection.
 * Each region is a covariance-aligned ellipsoid, NOT a statistical confidence
 * interval or a learned semantic boundary. Coordinates are never modified.
 */
import type { MapPoint } from '../types';

export interface RegionCloud {
  cluster: number;
  count: number;
  center: [number, number, number];
  radii: [number, number, number];
  x: number[];
  y: number[];
  z: number[];
  i: number[];
  j: number[];
  k: number[];
}

type Vector = [number, number, number];
type Matrix = [Vector, Vector, Vector];

// Jacobi diagonalization of a tiny symmetric 3x3 covariance matrix.
function principalAxes(covariance: Matrix): { radiiVariance: Vector; axes: Vector[] } {
  const a: number[][] = covariance.map(row => [...row]);
  const v: number[][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iteration = 0; iteration < 28; iteration++) {
    const pairs: Array<[number, number]> = [[0, 1], [0, 2], [1, 2]];
    pairs.sort((u, w) => Math.abs(a[w[0]][w[1]]) - Math.abs(a[u[0]][u[1]]));
    const [p, q] = pairs[0];
    const off = a[p][q];
    if (Math.abs(off) < 1e-12) break;
    const tau = (a[q][q] - a[p][p]) / (2 * off);
    const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;
    const app = a[p][p], aqq = a[q][q];
    a[p][p] = app - t * off;
    a[q][q] = aqq + t * off;
    a[p][q] = a[q][p] = 0;
    for (let h = 0; h < 3; h++) {
      if (h !== p && h !== q) {
        const ahp = a[h][p], ahq = a[h][q];
        a[h][p] = a[p][h] = c * ahp - s * ahq;
        a[h][q] = a[q][h] = s * ahp + c * ahq;
      }
      const vhp = v[h][p], vhq = v[h][q];
      v[h][p] = c * vhp - s * vhq;
      v[h][q] = s * vhp + c * vhq;
    }
  }
  const ordered = [0, 1, 2].sort((p, q) => a[q][q] - a[p][p]);
  return {
    radiiVariance: ordered.map(n => Math.max(0, a[n][n])) as Vector,
    axes: ordered.map(n => [v[0][n], v[1][n], v[2][n]] as Vector),
  };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Low-poly closed ellipsoids; one per current cluster (max 7 in this app). */
export function buildRegionClouds(points: MapPoint[]): RegionCloud[] {
  const groups = new Map<number, Vector[]>();
  for (const p of points) {
    if (![p.x, p.y, p.z].every(Number.isFinite)) continue;
    const group = groups.get(p.cluster) ?? [];
    group.push([p.x, p.y, p.z]);
    groups.set(p.cluster, group);
  }
  const result: RegionCloud[] = [];
  for (const [cluster, locations] of [...groups].sort(([a], [b]) => a - b)) {
    const center = [0, 0, 0] as Vector;
    for (const value of locations) for (let d = 0; d < 3; d++) center[d] += value[d];
    for (let d = 0; d < 3; d++) center[d] /= locations.length;
    const covariance: Matrix = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const value of locations) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      covariance[a][b] += (value[a] - center[a]) * (value[b] - center[b]) / locations.length;
    }
    const { radiiVariance, axes } = principalAxes(covariance);
    // Overlap between nearby groups is intentional: clusters are approximate.
    // A small floor also makes one- and two-paper groups visible.
    const radii = radiiVariance.map(value => clamp(0.32 + 2.0 * Math.sqrt(value), 0.32, 2.75)) as Vector;
    const x: number[] = [], y: number[] = [], z: number[] = [];
    const i: number[] = [], j: number[] = [], k: number[] = [];
    const latSteps = 10, lonSteps = 18;
    for (let latitude = 0; latitude <= latSteps; latitude++) {
      const polar = Math.PI * latitude / latSteps;
      for (let longitude = 0; longitude < lonSteps; longitude++) {
        const angle = 2 * Math.PI * longitude / lonSteps;
        const unit = [Math.sin(polar) * Math.cos(angle), Math.sin(polar) * Math.sin(angle), Math.cos(polar)];
        const point: Vector = [...center];
        for (let axis = 0; axis < 3; axis++) for (let d = 0; d < 3; d++) {
          point[d] += unit[axis] * radii[axis] * axes[axis][d];
        }
        x.push(point[0]); y.push(point[1]); z.push(point[2]);
      }
    }
    for (let latitude = 0; latitude < latSteps; latitude++) for (let longitude = 0; longitude < lonSteps; longitude++) {
      const current = latitude * lonSteps + longitude;
      const next = latitude * lonSteps + (longitude + 1) % lonSteps;
      const below = current + lonSteps;
      const belowNext = next + lonSteps;
      i.push(current, next);
      j.push(below, below);
      k.push(next, belowNext);
    }
    result.push({ cluster, count: locations.length, center, radii, x, y, z, i, j, k });
  }
  return result;
}
