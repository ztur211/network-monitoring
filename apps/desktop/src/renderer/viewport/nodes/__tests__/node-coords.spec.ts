// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { toViewport, toModel } from '../node-coords';

const frame = { recenter: new THREE.Vector3(10, 20, 30), upConversion: 'Z_UP_TO_Y_UP' as const };

describe('node-coords', () => {
  it('maps native Z-up → viewport Y-up about the recenter', () => {
    // a point at the recenter maps to the origin; native +Z becomes viewport +Y
    expect(toViewport({ x: 10, y: 20, z: 30 }, frame).length()).toBeLessThan(1e-6);
    const up = toViewport({ x: 10, y: 20, z: 31 }, frame); // +1 in native Z
    expect(up.y).toBeCloseTo(1, 5);
    expect(Math.abs(up.x) + Math.abs(up.z)).toBeLessThan(1e-6);
  });
  it('round-trips toModel(toViewport(p)) ≈ p', () => {
    const p = { x: 12.5, y: 7, z: 41.2 };
    const back = toModel(toViewport(p, frame), frame);
    expect(back.x).toBeCloseTo(p.x, 4);
    expect(back.y).toBeCloseTo(p.y, 4);
    expect(back.z).toBeCloseTo(p.z, 4);
  });
});
