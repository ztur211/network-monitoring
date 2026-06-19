// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { pickExpressId } from '../picking';

function modelWith(mesh: THREE.Mesh) {
  return { elementIndex: new Map([[mesh.userData.expressID as number, mesh]]) } as any;
}
const vis = {
  hiddenCategories: new Set<string>(),
  hiddenElements: new Set<number>(),
  isolated: null as number | null,
};

describe('pickExpressId', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  mesh.userData = { expressID: 7, ifcType: 'IfcWall' };
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(0, 0), cam);

  it('returns the expressID of the mesh under the ray', () => {
    expect(pickExpressId(ray, modelWith(mesh), vis)).toBe(7);
  });
  it('skips hidden meshes', () => {
    expect(pickExpressId(ray, modelWith(mesh), { ...vis, hiddenElements: new Set([7]) })).toBeNull();
  });
  it('returns null when the ray misses', () => {
    const miss = new THREE.Raycaster();
    miss.setFromCamera(new THREE.Vector2(0.99, 0.99), cam);
    expect(pickExpressId(miss, modelWith(mesh), vis)).toBeNull();
  });
});
