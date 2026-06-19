// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { toViewportDir, toModelDir } from '../node-coords';

const frame = { recenter: new THREE.Vector3(10, 20, 30), upConversion: 'Z_UP_TO_Y_UP' as const };

describe('node-coords direction helpers', () => {
  it('native +Z direction → viewport +Y direction (Z-up to Y-up rotation)', () => {
    const vDir = toViewportDir({ x: 0, y: 0, z: 1 }, frame);
    expect(vDir.x).toBeCloseTo(0, 5);
    expect(vDir.y).toBeCloseTo(1, 5);
    expect(vDir.z).toBeCloseTo(0, 5);
  });

  it('native +Y direction → viewport -Z direction', () => {
    const vDir = toViewportDir({ x: 0, y: 1, z: 0 }, frame);
    expect(vDir.x).toBeCloseTo(0, 5);
    expect(vDir.y).toBeCloseTo(0, 5);
    expect(vDir.z).toBeCloseTo(-1, 5);
  });

  it('native +X direction is unchanged (X is unaffected by Rx)', () => {
    const vDir = toViewportDir({ x: 1, y: 0, z: 0 }, frame);
    expect(vDir.x).toBeCloseTo(1, 5);
    expect(vDir.y).toBeCloseTo(0, 5);
    expect(vDir.z).toBeCloseTo(0, 5);
  });

  it('round-trips: toModelDir(toViewportDir(v)) ≈ v', () => {
    const native = { x: 0.6, y: 0.0, z: 0.8 };
    const vp = toViewportDir(native, frame);
    const back = toModelDir(vp, frame);
    expect(back.x).toBeCloseTo(native.x, 4);
    expect(back.y).toBeCloseTo(native.y, 4);
    expect(back.z).toBeCloseTo(native.z, 4);
  });

  it('direction helpers are translation-independent (no recenter bias)', () => {
    const frameA = { recenter: new THREE.Vector3(0, 0, 0), upConversion: 'Z_UP_TO_Y_UP' as const };
    const frameB = { recenter: new THREE.Vector3(100, 200, 300), upConversion: 'Z_UP_TO_Y_UP' as const };
    const v = { x: 1, y: 2, z: 3 };
    const a = toViewportDir(v, frameA);
    const b = toViewportDir(v, frameB);
    expect(a.x).toBeCloseTo(b.x, 5);
    expect(a.y).toBeCloseTo(b.y, 5);
    expect(a.z).toBeCloseTo(b.z, 5);
  });
});
