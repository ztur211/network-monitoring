// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyViewpoint } from '../apply-viewpoint';
import type { ParsedModel } from '../ifc-types';

/** Minimal ParsedModel stub with two elements, each with a known GlobalId. */
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
      // Non-zero recenter so we can verify it is applied.
      recenter: new THREE.Vector3(5, 10, 15),
      upConversion: 'Z_UP_TO_Y_UP',
    },
    getProperties: async () => ({}) as any,
    dispose: () => {},
  };
}

describe('applyViewpoint', () => {
  it('converts a Z-up BCF camera position to Y-up viewport position', () => {
    const model = makeModel();
    // Recenter = (5,10,15). toViewport subtracts recenter then rotates Rx(-90°).
    // Native position (5, 10, 15) → after -recenter = (0,0,0) → Rx(-90°)(0,0,0) = (0,0,0)
    const result = applyViewpoint(
      {
        camera: {
          kind: 'perspective',
          position: [5, 10, 15], // native coords equal to recenter → viewport origin
          direction: [0, 0, -1],
          up: [0, 0, 1],
          fieldOfView: 60,
        },
        components: { selection: [], visibility: { defaultVisibility: true, exceptions: [] } },
      },
      model,
    );
    expect(result.position.x).toBeCloseTo(0, 5);
    expect(result.position.y).toBeCloseTo(0, 5);
    expect(result.position.z).toBeCloseTo(0, 5);
  });

  it('converts camera direction: native +Z → viewport +Y', () => {
    const model = makeModel();
    const result = applyViewpoint(
      {
        camera: {
          kind: 'perspective',
          position: [0, 0, 0],
          direction: [0, 0, 1], // native Z-up
          up: [0, 1, 0],
          fieldOfView: 45,
        },
        components: { selection: [], visibility: { defaultVisibility: true, exceptions: [] } },
      },
      model,
    );
    // Rx(-90°) maps Z→Y
    expect(result.direction.x).toBeCloseTo(0, 5);
    expect(result.direction.y).toBeCloseTo(1, 5);
    expect(result.direction.z).toBeCloseTo(0, 5);
  });

  it('resolves BCF GlobalIds to expressIDs for selection', () => {
    const model = makeModel();
    const result = applyViewpoint(
      {
        camera: {
          kind: 'perspective',
          position: [0, 0, 0],
          direction: [0, 0, -1],
          up: [0, 0, 1],
        },
        components: {
          selection: ['GUID-A'],
          visibility: { defaultVisibility: true, exceptions: [] },
        },
      },
      model,
    );
    expect(result.selectedIds).toEqual([10]);
  });

  it('skips unknown GlobalIds in selection', () => {
    const model = makeModel();
    const result = applyViewpoint(
      {
        camera: {
          kind: 'perspective',
          position: [0, 0, 0],
          direction: [0, 0, -1],
          up: [0, 0, 1],
        },
        components: {
          selection: ['UNKNOWN-GUID'],
          visibility: { defaultVisibility: true, exceptions: [] },
        },
      },
      model,
    );
    expect(result.selectedIds).toEqual([]);
  });

  it('defaultVisibility=true: exceptions become hiddenIds, hideAll=false', () => {
    const model = makeModel();
    const result = applyViewpoint(
      {
        camera: {
          kind: 'perspective',
          position: [0, 0, 0],
          direction: [0, 0, -1],
          up: [0, 0, 1],
        },
        components: {
          selection: [],
          visibility: { defaultVisibility: true, exceptions: ['GUID-B'] },
        },
      },
      model,
    );
    expect(result.hideAll).toBe(false);
    expect(result.hiddenIds).toEqual([20]);
  });

  it('defaultVisibility=false: all elements except exceptions are hidden, hideAll=true', () => {
    const model = makeModel();
    const result = applyViewpoint(
      {
        camera: {
          kind: 'perspective',
          position: [0, 0, 0],
          direction: [0, 0, -1],
          up: [0, 0, 1],
        },
        components: {
          selection: [],
          // Only GUID-A (expressID=10) should remain visible.
          visibility: { defaultVisibility: false, exceptions: ['GUID-A'] },
        },
      },
      model,
    );
    expect(result.hideAll).toBe(true);
    // expressID 20 should be in hiddenIds; 10 should not.
    expect(result.hiddenIds).toContain(20);
    expect(result.hiddenIds).not.toContain(10);
  });

  it('orthographic camera: fieldOfView is undefined', () => {
    const model = makeModel();
    const result = applyViewpoint(
      {
        camera: {
          kind: 'orthographic',
          position: [0, 0, 10],
          direction: [0, 0, -1],
          up: [0, 1, 0],
          viewToWorldScale: 0.01,
        },
        components: { selection: [], visibility: { defaultVisibility: true, exceptions: [] } },
      },
      model,
    );
    expect(result.fieldOfView).toBeUndefined();
  });

  it('perspective camera: fieldOfView is passed through', () => {
    const model = makeModel();
    const result = applyViewpoint(
      {
        camera: {
          kind: 'perspective',
          position: [0, 0, 10],
          direction: [0, 0, -1],
          up: [0, 0, 1],
          fieldOfView: 75,
        },
        components: { selection: [], visibility: { defaultVisibility: true, exceptions: [] } },
      },
      model,
    );
    expect(result.fieldOfView).toBe(75);
  });
});
