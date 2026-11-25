import type { RegionCloud } from './clouds';
import type { MapPoint } from '../types';

type Vec = [number, number, number];
export interface RegionCallout { cluster: number; label: Vec; tip: Vec; x: (number|null)[]; y: (number|null)[]; z: (number|null)[] }
const add = (a: Vec, b: Vec): Vec => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const sub = (a: Vec, b: Vec): Vec => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const mul = (a: Vec, k: number): Vec => [a[0]*k,a[1]*k,a[2]*k];
const dot = (a: Vec, b: Vec) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const norm = (a: Vec) => Math.hypot(...a);
const unit = (a: Vec): Vec => norm(a)>1e-9 ? mul(a,1/norm(a)) : [1,0,0];
const cross = (a: Vec,b: Vec): Vec => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const position = (p: MapPoint): Vec => [p.x,p.y,p.z];

/** Label anchors outside the displayed clouds and points. No paper coordinates are changed. */
export function buildRegionCallouts(clouds: RegionCloud[], points: MapPoint[]): RegionCallout[] {
  const ordered = [...clouds].sort((a,b)=>a.cluster-b.cluster);
  if (!ordered.length) return [];
  const vertices = (c: RegionCloud): Vec[] => c.x.map((x,i)=>[x,c.y[i],c.z[i]]);
  const all = [...ordered.flatMap(vertices), ...points.map(position)].filter(p=>p.every(Number.isFinite));
  if (!all.length) return [];
  const origin = mul(ordered.reduce((s,c)=>add(s,c.center),[0,0,0] as Vec),1/ordered.length);
  const extent = Math.max(0.5,...all.map(p=>norm(sub(p,origin))));
  const gap = Math.max(0.45,extent*0.12);
  const directions: Vec[] = [];
  // Candidate rays on a sphere, plus the preferred outward ray for each group.
  const candidates: Vec[] = Array.from({length:48},(_,i)=>{
    const z = 1-2*(i+0.5)/48, theta = i*Math.PI*(3-Math.sqrt(5));
    const r = Math.sqrt(1-z*z); return [r*Math.cos(theta),r*Math.sin(theta),z];
  });
  return ordered.map(c=>{
    const radial = sub(c.center,origin);
    const preferred = norm(radial)>1e-8 ? unit(radial) : null;
    const score = (v:Vec) => (preferred ? 1.4*dot(v,preferred):0) - 2.2*Math.max(0,...directions.map(d=>dot(v,d)));
    const options = preferred ? [preferred,...candidates] : candidates;
    const dir = options.reduce((best,v)=>score(v)>score(best)?v:best,options[0]);
    directions.push(dir);
    const own = vertices(c);
    const tip = own.reduce((best,v)=>dot(v,dir)>dot(best,dir)?v:best,c.center);
    // Position beyond the supporting plane of every visible volume and point.
    const distance = Math.max(0,...all.map(p=>dot(sub(p,tip),dir)))+gap;
    const label = add(tip,mul(dir,distance));
    // Four small wings produce a 3D arrowhead at the cloud surface.
    const back = add(tip,mul(dir,Math.min(distance*0.35,gap*0.48)));
    const side = unit(cross(dir,Math.abs(dir[2])<0.85?[0,0,1]:[0,1,0]));
    const up = unit(cross(dir,side));
    const wing = Math.min(distance*0.18,gap*0.22);
    const segments: (Vec|null)[] = [label,tip,null];
    for(const v of [side,mul(side,-1),up,mul(up,-1)]) segments.push(add(back,mul(v,wing)),tip,null);
    return {cluster:c.cluster,label,tip,x:segments.map(p=>p?p[0]:null),y:segments.map(p=>p?p[1]:null),z:segments.map(p=>p?p[2]:null)};
  });
}
