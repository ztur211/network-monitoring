import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { sectionToPlane } from '../section';

describe('sectionToPlane', () => {
  it('returns null when disabled', () =>
    expect(sectionToPlane({ enabled: false, axis: 'Y', constant: 0 })).toBeNull());
  it('builds a Y plane that keeps the region below the cut', () => {
    const plane = sectionToPlane({ enabled: true, axis: 'Y', constant: 2 })!;
    expect(plane).toBeInstanceOf(THREE.Plane);
    // below the cut → kept (signed distance > 0); above → clipped (< 0)
    expect(plane.distanceToPoint(new THREE.Vector3(0, 1, 0))).toBeGreaterThan(0);
    expect(plane.distanceToPoint(new THREE.Vector3(0, 3, 0))).toBeLessThan(0);
  });
});
