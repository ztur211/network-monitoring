// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createModelRender } from '../model-render';
import type { MergedCategory } from '../merge';

// A unit cube's worth of two triangles is enough to exercise the BVH + ranges.
function cat(ifcType: string, expressIDs: number[]): MergedCategory {
  const perEl = 3; // verts per element
  const position: number[] = [];
  const index: number[] = [];
  const ranges = expressIDs.map((expressID, e) => {
    const base = e * perEl;
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

describe('createModelRender', () => {
  it('builds one mesh per category and an elementIndex of refs', () => {
    const r = createModelRender([cat('IfcWall', [1, 2]), cat('IfcSlab', [3])]);
    expect(r.categories.size).toBe(2);
    expect(r.meshes.filter((m) => m.userData.overlay !== true)).toHaveLength(2); // 2 category meshes
    expect(r.elementIndex.size).toBe(3);
    expect(r.elementIndex.get(2)!.ifcType).toBe('IfcWall');
    expect(r.elementIndex.get(2)!.indexCount).toBe(3);
    expect(r.categories.get('IfcWall')!.pickBVH).not.toBeNull();
  });

  it('applyVisibility rebuilds the render index / toggles mesh.visible', () => {
    const r = createModelRender([cat('IfcWall', [1, 2])]);
    const mesh = r.categories.get('IfcWall')!.mesh;
    // hide element 2 → render index shrinks to element 1's 3 entries
    r.applyVisibility({ hiddenCategories: new Set(), hiddenElements: new Set([2]), isolated: null });
    expect(mesh.visible).toBe(true);
    expect(mesh.geometry.getIndex()!.count).toBe(3);
    // hide the whole category → mesh hidden
    r.applyVisibility({ hiddenCategories: new Set(['IfcWall']), hiddenElements: new Set(), isolated: null });
    expect(mesh.visible).toBe(false);
    // all visible again → full index (6 entries)
    r.applyVisibility({ hiddenCategories: new Set(), hiddenElements: new Set(), isolated: null });
    expect(mesh.visible).toBe(true);
    expect(mesh.geometry.getIndex()!.count).toBe(6);
  });

  it('applyHighlight drives the overlay; null clears it', () => {
    const r = createModelRender([cat('IfcWall', [1, 2])]);
    r.applyHighlight(2);
    expect(r.overlay.visible).toBe(true);
    expect(r.overlay.geometry.getAttribute('position').count).toBe(3); // just element 2
    r.applyHighlight(null);
    expect(r.overlay.visible).toBe(false);
  });

  it('pick returns the nearest visible element + world hit point', () => {
    const r = createModelRender([cat('IfcWall', [1, 2])]);
    // element 1's triangle lies in z=0 around x,y∈[0,1]; shoot a ray straight down -Z through (0.2,0.2).
    const ray = new THREE.Raycaster(new THREE.Vector3(0.2, 0.2, 5), new THREE.Vector3(0, 0, -1));
    const vis = { hiddenCategories: new Set<string>(), hiddenElements: new Set<number>(), isolated: null };
    const hit = r.pick(ray, vis);
    expect(hit?.expressID).toBe(1);
    expect(hit?.point.z).toBeCloseTo(0, 5);
    // hide element 1 → ray no longer hits it (element 2 sits at x≈3, ray misses) → null
    expect(r.pick(ray, { ...vis, hiddenElements: new Set([1]) })).toBeNull();
  });

  it('elementBox returns the element world bbox', () => {
    const r = createModelRender([cat('IfcWall', [1, 2])]);
    const box = r.elementBox(1)!;
    expect(box.min.x).toBeCloseTo(0, 5);
    expect(box.max.x).toBeCloseTo(1, 5);
    expect(box.max.y).toBeCloseTo(1, 5);
    expect(r.elementBox(999)).toBeNull();
  });

  it('dispose frees category geometry attributes without throwing', () => {
    const r = createModelRender([cat('IfcWall', [1, 2])]);
    const mesh = r.categories.get('IfcWall')!.mesh;
    expect(() => r.dispose()).not.toThrow();
    expect((mesh.geometry as THREE.BufferGeometry).attributes.position).toBeUndefined();
  });
});
