// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { captureViewpoint } from '../capture-viewpoint';
import { toIfcGuid } from '@nodescope/shared';

const frame = { recenter: new THREE.Vector3(), upConversion: 'Z_UP_TO_Y_UP' as const };

describe('captureViewpoint (bcf/)', () => {
  it('captures the live camera into a BCF viewpoint (native coords) with the selected device GUID', () => {
    const vp = captureViewpoint(
      {
        position: new THREE.Vector3(0, 5, 0),
        target: new THREE.Vector3(0, 0, 0),
        up: new THREE.Vector3(0, 0, -1),
        fov: 60,
      },
      frame,
      'dev1',
    );
    // viewport +Y (=5) → native +Z (floating-point tolerant)
    expect(vp.camera.position[0]).toBeCloseTo(0, 5);
    expect(vp.camera.position[1]).toBeCloseTo(0, 5);
    expect(vp.camera.position[2]).toBeCloseTo(5, 5);
    expect(vp.components.selection).toEqual([toIfcGuid('dev1')]);
    expect(vp.camera.kind).toBe('perspective');
  });

  it('empty selection when no selectedDeviceId given', () => {
    const vp = captureViewpoint(
      { position: new THREE.Vector3(0, 0, 0), target: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0), fov: 50 },
      frame,
    );
    expect(vp.components.selection).toEqual([]);
  });

  it('direction from position to target is normalized in native coords', () => {
    // viewport: position (0,5,0) looking at (0,0,0) → viewport direction is (0,-1,0)
    // native: Rx(+90°) maps -Y → -Z in direction... let's test actual values
    const vp = captureViewpoint(
      {
        position: new THREE.Vector3(0, 5, 0),
        target: new THREE.Vector3(0, 0, 0),
        up: new THREE.Vector3(0, 0, -1),
        fov: 45,
      },
      frame,
    );
    const [dx, dy, dz] = vp.camera.direction;
    const len = Math.hypot(dx, dy, dz);
    expect(len).toBeCloseTo(1, 5);
  });

  it('fieldOfView is passed through', () => {
    const vp = captureViewpoint(
      { position: new THREE.Vector3(0, 0, 0), target: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0), fov: 75 },
      frame,
    );
    expect(vp.camera.fieldOfView).toBe(75);
  });

  it('defaultVisibility is always true with empty exceptions', () => {
    const vp = captureViewpoint(
      { position: new THREE.Vector3(0, 0, 0), target: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0), fov: 50 },
      frame,
    );
    expect(vp.components.visibility.defaultVisibility).toBe(true);
    expect(vp.components.visibility.exceptions).toEqual([]);
  });
});
