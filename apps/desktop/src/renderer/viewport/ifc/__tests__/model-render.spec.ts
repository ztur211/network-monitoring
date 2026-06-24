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

  it('pick skips a hidden element in front and returns the visible one behind', () => {
    // Two triangles under the SAME -Z ray: element 1 @ z=0 (behind), element 2 @ z=2 (in front).
    const position = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, // element 1 @ z=0
      0, 0, 2, 1, 0, 2, 0, 1, 2, // element 2 @ z=2
    ]);
    const merged = {
      ifcType: 'IfcWall',
      position,
      normal: new Float32Array(position.length),
      color: new Float32Array(position.length).fill(1),
      index: new Uint32Array([0, 1, 2, 3, 4, 5]),
      ranges: [
        { expressID: 1, indexStart: 0, indexCount: 3 },
        { expressID: 2, indexStart: 3, indexCount: 3 },
      ],
    };
    const r = createModelRender([merged]);
    const ray = new THREE.Raycaster(new THREE.Vector3(0.2, 0.2, 5), new THREE.Vector3(0, 0, -1));
    const all = { hiddenCategories: new Set<string>(), hiddenElements: new Set<number>(), isolated: null };
    // all visible → nearest to the ray origin (z=5) is element 2 (z=2)
    expect(r.pick(ray, all)?.expressID).toBe(2);
    // hide element 2 (the one in front) → pick returns element 1 (behind), NOT null
    expect(r.pick(ray, { ...all, hiddenElements: new Set([2]) })?.expressID).toBe(1);
  });

  it('applyHighlight replaces the previous overlay geometry on repeated calls', () => {
    const r = createModelRender([cat('IfcWall', [1, 2])]);
    r.applyHighlight(1);
    const first = r.overlay.geometry;
    r.applyHighlight(2);
    expect(r.overlay.geometry).not.toBe(first); // replaced, not accumulated
    expect(r.overlay.geometry.getAttribute('position').count).toBe(3); // just element 2
  });

  it('pick + visibility stay correct on a multi-triangle, spatially-shuffled category (BVH must not reorder the shared index)', () => {
    // 6 quad elements (2 tris each = 12 tris total → forces a multi-leaf BVH).
    // expressID ASCENDING is laid out at X DESCENDING, so a spatial BVH sort reorders triangles
    // away from concat order — which corrupts faceIndex→expressID unless the BVH is built indirect.
    const ids = [10, 20, 30, 40, 50, 60];
    const position: number[] = [];
    const index: number[] = [];
    const ranges = ids.map((expressID, i) => {
      const bx = (ids.length - 1 - i) * 5; // id 10→X25, 20→X20, ... 60→X0
      const vb = i * 4;
      position.push(bx, 0, 0, bx + 2, 0, 0, bx + 2, 2, 0, bx, 2, 0);
      const indexStart = index.length;
      index.push(vb, vb + 1, vb + 2, vb, vb + 2, vb + 3);
      return { expressID, indexStart, indexCount: 6 };
    });
    const merged = {
      ifcType: 'IfcWall',
      position: new Float32Array(position),
      normal: new Float32Array(position.length),
      color: new Float32Array(position.length).fill(1),
      index: new Uint32Array(index),
      ranges,
    };
    const r = createModelRender([merged]);
    const all = { hiddenCategories: new Set<string>(), hiddenElements: new Set<number>(), isolated: null };
    const rayAt = (x: number) => new THREE.Raycaster(new THREE.Vector3(x + 1, 1, 5), new THREE.Vector3(0, 0, -1));
    // Each id sits at X=(5-i)*5: id 10→X25, 40→X10, 60→X0. Pick must return the geometrically-correct id.
    expect(r.pick(rayAt(25), all)?.expressID).toBe(10);
    expect(r.pick(rayAt(10), all)?.expressID).toBe(40);
    expect(r.pick(rayAt(0), all)?.expressID).toBe(60);
    // Hiding element 10 must remove ELEMENT 10's triangles → a ray at X25 now misses (null),
    // while a different element is unaffected.
    expect(r.pick(rayAt(25), { ...all, hiddenElements: new Set([10]) })).toBeNull();
    expect(r.pick(rayAt(0), { ...all, hiddenElements: new Set([10]) })?.expressID).toBe(60);
  });
});
