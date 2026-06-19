// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { fitCameraToBox } from '../fit';

describe('fitCameraToBox', () => {
  it('targets the box centre and pulls the camera back far enough to see it', () => {
    const box = new THREE.Box3(new THREE.Vector3(-2, -2, -2), new THREE.Vector3(2, 2, 2));
    const { position, target } = fitCameraToBox(box, 50, 1);
    const center = box.getCenter(new THREE.Vector3());
    expect(target.distanceTo(center)).toBeLessThan(1e-6);
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    expect(position.distanceTo(center)).toBeGreaterThan(radius); // outside the model
  });

  it('handles an empty box without NaN', () => {
    const box = new THREE.Box3(); // empty
    const { position, target } = fitCameraToBox(box, 50, 1);
    expect(Number.isFinite(position.x) && Number.isFinite(target.x)).toBe(true);
  });
});
