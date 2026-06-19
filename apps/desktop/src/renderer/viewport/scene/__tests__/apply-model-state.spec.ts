// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyModelState } from '../apply-model-state';
import type { ParsedModel } from '../../ifc/ifc-types';
import type { Selection } from '../../../stores/viewport-store';

function model(): ParsedModel {
  const mk = (id: number, t: string) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial());
    m.userData = { expressID: id, ifcType: t };
    return m;
  };
  const a = mk(1, 'IfcWall');
  const b = mk(2, 'IfcSlab');
  const root = new THREE.Group();
  root.add(a, b);
  return {
    root,
    categories: new Map(),
    elementIndex: new Map([
      [1, a],
      [2, b],
    ]),
    guidIndex: new Map(),
    bbox: new THREE.Box3(),
    frame: { recenter: new THREE.Vector3(), upConversion: 'Z_UP_TO_Y_UP' },
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

describe('applyModelState', () => {
  it('hides a category', () => {
    const m = model();
    applyModelState(m, { ...base, hiddenCategories: new Set(['IfcSlab']) });
    expect(m.elementIndex.get(1)!.visible).toBe(true);
    expect(m.elementIndex.get(2)!.visible).toBe(false);
  });
  it('highlights only the selected element (emissive)', () => {
    const m = model();
    applyModelState(m, { ...base, selection: { kind: 'element', expressID: 1 } });
    expect((m.elementIndex.get(1)!.material as THREE.MeshLambertMaterial).emissive.getHex()).not.toBe(0x000000);
    expect((m.elementIndex.get(2)!.material as THREE.MeshLambertMaterial).emissive.getHex()).toBe(0x000000);
  });
  it('attaches a clipping plane when the section is enabled', () => {
    const m = model();
    applyModelState(m, { ...base, section: { enabled: true, axis: 'Y', constant: 1 } });
    expect((m.elementIndex.get(1)!.material as THREE.Material).clippingPlanes).toHaveLength(1);
    applyModelState(m, base);
    expect((m.elementIndex.get(1)!.material as THREE.Material).clippingPlanes).toBeNull();
  });
});
