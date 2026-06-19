// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { pickNode } from '../picking-nodes';

function markerAt(deviceId: string, z: number) {
  const s = new THREE.Sprite();
  s.position.set(0, 0, z);
  s.scale.set(2, 2, 1);
  s.userData = { deviceId };
  s.updateMatrixWorld(); // standalone (no scene) → bake position into matrixWorld so raycast sees it
  return s;
}

describe('pickNode', () => {
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(0, 0), cam);

  it('returns the nearest marker deviceId under the ray', () => {
    expect(pickNode(ray, [markerAt('far', -5), markerAt('near', 5)])).toBe('near');
  });

  it('null when the ray misses every marker', () => {
    const miss = new THREE.Raycaster();
    miss.setFromCamera(new THREE.Vector2(0.99, 0.99), cam);
    expect(pickNode(miss, [markerAt('a', 0)])).toBeNull();
  });
});
