import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { Scene } from '../ViewportCanvas';
import type { ParsedModel } from '../../ifc/ifc-types';

// OrbitControls binds DOM events to the canvas domElement, which headless test-renderer lacks;
// stub it so the smoke can verify the scene graph (model + lights) mounts.
vi.mock('@react-three/drei', () => ({ OrbitControls: () => null }));

function fakeModel(): ParsedModel {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial());
  mesh.userData = { expressID: 1, ifcType: 'IfcWall' };
  root.add(mesh);
  return {
    root,
    categories: new Map([['IfcWall', root]]),
    elementIndex: new Map([[1, mesh]]),
    guidIndex: new Map(),
    bbox: new THREE.Box3().setFromObject(root),
    frame: { recenter: new THREE.Vector3(), upConversion: 'Z_UP_TO_Y_UP' },
    getProperties: async () => ({
      expressID: 1,
      ifcType: 'IfcWall',
      name: null,
      tag: null,
      propertySets: [],
    }),
    dispose: () => {},
  };
}

describe('ViewportCanvas (render smoke)', () => {
  it('mounts the model and lights without throwing', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Scene model={fakeModel()} />);
    expect(renderer.scene.findAllByType('Mesh').length).toBeGreaterThan(0);
    expect(renderer.scene.findAllByType('HemisphereLight').length).toBe(1);
    await renderer.unmount();
  });
});
