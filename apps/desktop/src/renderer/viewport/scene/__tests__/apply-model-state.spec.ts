// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyModelState } from '../apply-model-state';
import { createModelRender } from '../../ifc/model-render';
import type { MergedCategory } from '../../ifc/merge';
import type { ParsedModel } from '../../ifc/ifc-types';
import type { Selection } from '../../../stores/viewport-store';

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

function model(): ParsedModel {
  const render = createModelRender([cat('IfcWall', [1]), cat('IfcSlab', [2])]);
  return {
    root: new THREE.Group(),
    categories: new Map([...render.categories].map(([t, c]) => [t, c.mesh])),
    elementIndex: render.elementIndex,
    guidIndex: new Map(),
    bbox: new THREE.Box3(),
    frame: { recenter: new THREE.Vector3(), upConversion: 'Z_UP_TO_Y_UP' },
    render,
    getProperties: async () => ({}) as any,
    dispose: () => {},
  };
}
const base = {
  selection: null as Selection,
  hiddenCategories: new Set<string>(),
  hiddenElements: new Set<number>(),
  isolated: null as number | null,
  section: { enabled: false, axis: 'Y' as const, constant: 0 },
};

describe('applyModelState (merged)', () => {
  it('hides a category mesh', () => {
    const m = model();
    applyModelState(m, { ...base, hiddenCategories: new Set(['IfcSlab']) });
    expect(m.categories.get('IfcWall')!.visible).toBe(true);
    expect(m.categories.get('IfcSlab')!.visible).toBe(false);
  });
  it('highlights the selected element via the overlay', () => {
    const m = model();
    applyModelState(m, { ...base, selection: { kind: 'element', expressID: 1 } });
    expect(m.render.overlay.visible).toBe(true);
    applyModelState(m, base);
    expect(m.render.overlay.visible).toBe(false);
  });
  it('attaches a clipping plane to category materials when section is enabled', () => {
    const m = model();
    applyModelState(m, { ...base, section: { enabled: true, axis: 'Y', constant: 1 } });
    expect((m.categories.get('IfcWall')!.material as THREE.Material).clippingPlanes).toHaveLength(1);
    applyModelState(m, base);
    expect((m.categories.get('IfcWall')!.material as THREE.Material).clippingPlanes).toBeNull();
  });
});
