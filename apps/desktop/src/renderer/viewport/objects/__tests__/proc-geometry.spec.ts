import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildProcMesh } from '../proc-geometry';
import { modelForCategory } from '../device-model-registry';

const proc = (cat: string) =>
  modelForCategory(cat) as Extract<
    ReturnType<typeof modelForCategory>,
    { kind: 'proc' }
  >;

describe('buildProcMesh', () => {
  it('builds a non-empty group with a finite bbox (no NaN) for each shape', () => {
    for (const cat of ['SWITCH', 'ACCESS_POINT', 'SERVER_RACK', 'ONT', 'PHONE', 'CUSTOM']) {
      const g = buildProcMesh(proc(cat), 0x35c46a);
      let meshes = 0;
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes++;
      });
      expect(meshes).toBeGreaterThan(0);
      const box = new THREE.Box3().setFromObject(g);
      expect(Number.isFinite(box.min.x) && Number.isFinite(box.max.y)).toBe(true);
    }
  });

  it('rackbox has a front-face accent (2 meshes)', () => {
    let meshes = 0;
    buildProcMesh(proc('SWITCH'), 0).traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    expect(meshes).toBe(2);
  });

  it('applies the given color to the body material', () => {
    const g = buildProcMesh(proc('ONT'), 0xe5484d);
    const body = g.children.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh;
    expect((body.material as THREE.MeshStandardMaterial).color.getHex()).toBe(
      0xe5484d
    );
  });
});
