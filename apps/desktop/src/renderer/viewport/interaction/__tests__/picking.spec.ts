// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { pickExpressId } from '../picking';
import { createModelRender } from '../../ifc/model-render';
import type { MergedCategory } from '../../ifc/merge';

function cat(ifcType: string, expressIDs: number[]): MergedCategory {
  const position: number[] = [];
  const index: number[] = [];
  const ranges = expressIDs.map((expressID, e) => {
    const base = e * 3;
    position.push(base, 0, 0, base + 1, 0, 0, base, 1, 0);
    index.push(base, base + 1, base + 2);
    return { expressID, indexStart: e * 3, indexCount: 3 };
  });
  return {
    ifcType,
    position: new Float32Array(position),
    normal: new Float32Array(position.length),
    color: new Float32Array(position.length).fill(1),
    index: new Uint32Array(index),
    ranges,
  };
}
const model = () => ({ render: createModelRender([cat('IfcWall', [7])]) }) as any;
const vis = { hiddenCategories: new Set<string>(), hiddenElements: new Set<number>(), isolated: null as number | null };

describe('pickExpressId', () => {
  // element 7's triangle is in z=0 around x,y∈[0,1]; shoot down -Z through (0.2,0.2).
  const ray = () => new THREE.Raycaster(new THREE.Vector3(0.2, 0.2, 5), new THREE.Vector3(0, 0, -1));
  it('returns the expressID under the ray', () => expect(pickExpressId(ray(), model(), vis)).toBe(7));
  it('skips hidden elements', () =>
    expect(pickExpressId(ray(), model(), { ...vis, hiddenElements: new Set([7]) })).toBeNull());
  it('returns null when the ray misses', () => {
    const miss = new THREE.Raycaster(new THREE.Vector3(50, 50, 5), new THREE.Vector3(0, 0, -1));
    expect(pickExpressId(miss, model(), vis)).toBeNull();
  });
});
