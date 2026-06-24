import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { Scene } from '../ViewportCanvas';
import type { ParsedModel } from '../../ifc/ifc-types';
import { createModelRender } from '../../ifc/model-render';
import type { MergedCategory } from '../../ifc/merge';

// OrbitControls binds DOM events to the canvas domElement, which headless test-renderer lacks;
// stub it so the smoke can verify the scene graph (model + lights) mounts.
vi.mock('@react-three/drei', () => ({ OrbitControls: () => null }));

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

function fakeModel(): ParsedModel {
  const render = createModelRender([cat('IfcWall', [1])]);
  const root = new THREE.Group();
  for (const mesh of render.meshes) root.add(mesh);
  return {
    root,
    categories: new Map([...render.categories].map(([t, c]) => [t, c.mesh])),
    elementIndex: render.elementIndex,
    guidIndex: new Map(),
    bbox: new THREE.Box3().setFromObject(root),
    frame: { recenter: new THREE.Vector3(), upConversion: 'Z_UP_TO_Y_UP' },
    render,
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
