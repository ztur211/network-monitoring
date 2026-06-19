// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { captureViewpoint } from '../capture-viewpoint';
import type { ParsedModel } from '../ifc-types';

function makeModel(): ParsedModel {
  const meshA = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial());
  meshA.userData = { expressID: 10, ifcType: 'IfcWall' };
  const meshB = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial());
  meshB.userData = { expressID: 20, ifcType: 'IfcSlab' };
  const root = new THREE.Group();
  root.add(meshA, meshB);
  return {
    root,
    categories: new Map(),
    elementIndex: new Map([
      [10, meshA],
      [20, meshB],
    ]),
    guidIndex: new Map([
      ['GUID-A', 10],
      ['GUID-B', 20],
    ]),
    bbox: new THREE.Box3(),
    frame: {
      recenter: new THREE.Vector3(5, 10, 15),
      upConversion: 'Z_UP_TO_Y_UP',
    },
    getProperties: async () => ({}) as any,
    dispose: () => {},
  };
}

const TEST_GUID = 'test-vp-guid-0001';

describe('captureViewpoint', () => {
  it('outputs the provided guid', () => {
    const model = makeModel();
    const vp = captureViewpoint(
      {
        position: new THREE.Vector3(0, 0, 0),
        direction: new THREE.Vector3(0, 0, -1),
        up: new THREE.Vector3(0, 1, 0),
        fov: 50,
      },
      { selectedElementId: null, hiddenElements: new Set() },
      model,
      TEST_GUID,
    );
    expect(vp.guid).toBe(TEST_GUID);
  });

  it('converts Y-up viewport position back to Z-up native position', () => {
    const model = makeModel();
    // At viewport origin (0,0,0): native = Rx(+90°)(0,0,0) + recenter = (5,10,15)
    const vp = captureViewpoint(
      {
        position: new THREE.Vector3(0, 0, 0),
        direction: new THREE.Vector3(0, 0, -1),
        up: new THREE.Vector3(0, 1, 0),
        fov: 50,
      },
      { selectedElementId: null, hiddenElements: new Set() },
      model,
      TEST_GUID,
    );
    const [px, py, pz] = vp.camera.position;
    expect(px).toBeCloseTo(5, 4);
    expect(py).toBeCloseTo(10, 4);
    expect(pz).toBeCloseTo(15, 4);
  });

  it('converts Y-up direction to Z-up native direction: viewport +Y → native +Z', () => {
    const model = makeModel();
    const vp = captureViewpoint(
      {
        position: new THREE.Vector3(0, 0, 0),
        direction: new THREE.Vector3(0, 1, 0), // viewport +Y
        up: new THREE.Vector3(0, 0, 1),
        fov: 50,
      },
      { selectedElementId: null, hiddenElements: new Set() },
      model,
      TEST_GUID,
    );
    const [dx, dy, dz] = vp.camera.direction;
    // Rx(+90°) maps Y→Z, so native direction should be (0,0,1)
    expect(dx).toBeCloseTo(0, 4);
    expect(dy).toBeCloseTo(0, 4);
    expect(dz).toBeCloseTo(1, 4);
  });

  it('sets camera kind to perspective and includes fieldOfView', () => {
    const model = makeModel();
    const vp = captureViewpoint(
      {
        position: new THREE.Vector3(0, 5, 5),
        direction: new THREE.Vector3(0, 0, -1),
        up: new THREE.Vector3(0, 1, 0),
        fov: 60,
        kind: 'perspective',
      },
      { selectedElementId: null, hiddenElements: new Set() },
      model,
      TEST_GUID,
    );
    expect(vp.camera.kind).toBe('perspective');
    expect(vp.camera.fieldOfView).toBe(60);
  });

  it('includes selected element GlobalId in components.selection', () => {
    const model = makeModel();
    const vp = captureViewpoint(
      {
        position: new THREE.Vector3(0, 0, 0),
        direction: new THREE.Vector3(0, 0, -1),
        up: new THREE.Vector3(0, 1, 0),
      },
      { selectedElementId: 10, hiddenElements: new Set() },
      model,
      TEST_GUID,
    );
    expect(vp.components.selection).toContain('GUID-A');
    expect(vp.components.selection).not.toContain('GUID-B');
  });

  it('no selection when selectedElementId is null', () => {
    const model = makeModel();
    const vp = captureViewpoint(
      {
        position: new THREE.Vector3(0, 0, 0),
        direction: new THREE.Vector3(0, 0, -1),
        up: new THREE.Vector3(0, 1, 0),
      },
      { selectedElementId: null, hiddenElements: new Set() },
      model,
      TEST_GUID,
    );
    expect(vp.components.selection).toEqual([]);
  });

  it('skips selected element without a known GlobalId', () => {
    const model = makeModel();
    // expressID=99 has no entry in guidIndex
    const vp = captureViewpoint(
      {
        position: new THREE.Vector3(0, 0, 0),
        direction: new THREE.Vector3(0, 0, -1),
        up: new THREE.Vector3(0, 1, 0),
      },
      { selectedElementId: 99 as any, hiddenElements: new Set() },
      model,
      TEST_GUID,
    );
    expect(vp.components.selection).toEqual([]);
  });

  it('maps hidden elements to BCF GlobalId exceptions, defaultVisibility=true', () => {
    const model = makeModel();
    const vp = captureViewpoint(
      {
        position: new THREE.Vector3(0, 0, 0),
        direction: new THREE.Vector3(0, 0, -1),
        up: new THREE.Vector3(0, 1, 0),
      },
      { selectedElementId: null, hiddenElements: new Set([20]) },
      model,
      TEST_GUID,
    );
    expect(vp.components.visibility.defaultVisibility).toBe(true);
    expect(vp.components.visibility.exceptions).toContain('GUID-B');
    expect(vp.components.visibility.exceptions).not.toContain('GUID-A');
  });

  it('empty exceptions when nothing is hidden', () => {
    const model = makeModel();
    const vp = captureViewpoint(
      {
        position: new THREE.Vector3(0, 0, 0),
        direction: new THREE.Vector3(0, 0, -1),
        up: new THREE.Vector3(0, 1, 0),
      },
      { selectedElementId: null, hiddenElements: new Set() },
      model,
      TEST_GUID,
    );
    expect(vp.components.visibility.exceptions).toEqual([]);
    expect(vp.components.visibility.defaultVisibility).toBe(true);
  });

  it('round-trips with applyViewpoint: capture then apply restores original expressIDs', async () => {
    // Import applyViewpoint inline to avoid circular deps in test
    const { applyViewpoint } = await import('../apply-viewpoint');
    const model = makeModel();

    const captured = captureViewpoint(
      {
        position: new THREE.Vector3(3, 2, 1),
        direction: new THREE.Vector3(0, 0, -1).normalize(),
        up: new THREE.Vector3(0, 1, 0),
        fov: 50,
      },
      { selectedElementId: 10, hiddenElements: new Set([20]) },
      model,
      TEST_GUID,
    );

    const applied = applyViewpoint(captured, model);

    expect(applied.selectedIds).toContain(10);
    expect(applied.hiddenIds).toContain(20);
    expect(applied.hiddenIds).not.toContain(10);
    expect(applied.fieldOfView).toBe(50);
  });
});
