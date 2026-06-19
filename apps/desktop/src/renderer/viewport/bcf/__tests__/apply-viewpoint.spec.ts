// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyViewpoint } from '../apply-viewpoint';
import { toIfcGuid } from '@nodescope/shared';

const frame = { recenter: new THREE.Vector3(), upConversion: 'Z_UP_TO_Y_UP' as const };

describe('applyViewpoint (bcf/)', () => {
  it('resolves camera + splits component GUIDs into devices and elements', () => {
    const vp = {
      camera: {
        kind: 'perspective',
        position: [0, 0, 5],
        direction: [0, 0, -1],
        up: [0, 1, 0],
        fieldOfView: 60,
      },
      components: {
        selection: [toIfcGuid('dev1'), 'ELEM-GUID'],
        visibility: { defaultVisibility: true, exceptions: ['ELEM-HIDDEN'] },
      },
    } as any;

    const guidIndex = new Map([
      ['ELEM-GUID', 7],
      ['ELEM-HIDDEN', 9],
    ]);
    const deviceGuidMap = new Map([[toIfcGuid('dev1'), 'dev1']]);

    const r = applyViewpoint(vp, frame, guidIndex, deviceGuidMap);

    expect(r.selectionDeviceIds).toEqual(['dev1']);
    expect(r.selectionExpressIds).toEqual([7]);
    expect(r.hiddenExpressIds).toEqual([9]); // defaultVisibility true → exceptions hidden
    // native +Z (position[2]=5) → viewport +Y
    expect(r.camera.position.y).toBeCloseTo(5, 5);
  });

  it('defaultVisibility=false: hides all except exceptions', () => {
    const vp = {
      camera: {
        kind: 'perspective',
        position: [0, 0, 0],
        direction: [0, 0, -1],
        up: [0, 1, 0],
      },
      components: {
        selection: [],
        visibility: { defaultVisibility: false, exceptions: ['ELEM-GUID'] },
      },
    } as any;

    const guidIndex = new Map([
      ['ELEM-GUID', 7],
      ['ELEM-HIDDEN', 9],
    ]);

    const r = applyViewpoint(vp, frame, guidIndex, new Map());

    // ELEM-HIDDEN (9) should be hidden; ELEM-GUID (7) should not
    expect(r.hiddenExpressIds).toContain(9);
    expect(r.hiddenExpressIds).not.toContain(7);
  });

  it('camera target = position + direction', () => {
    const vp = {
      camera: {
        kind: 'perspective',
        position: [0, 0, 0],
        direction: [0, 0, 1], // native +Z → viewport +Y
        up: [0, 1, 0],
        fieldOfView: 50,
      },
      components: { selection: [], visibility: { defaultVisibility: true, exceptions: [] } },
    } as any;

    const r = applyViewpoint(vp, frame, new Map(), new Map());

    // target = position + dir; dir should be +Y in viewport
    expect(r.camera.target.y).toBeCloseTo(1, 5);
    expect(r.camera.fov).toBe(50);
  });

  it('fov defaults to 50 when fieldOfView absent', () => {
    const vp = {
      camera: { kind: 'perspective', position: [0, 0, 0], direction: [0, 0, -1], up: [0, 1, 0] },
      components: { selection: [], visibility: { defaultVisibility: true, exceptions: [] } },
    } as any;

    const r = applyViewpoint(vp, frame, new Map(), new Map());
    expect(r.camera.fov).toBe(50);
  });

  it('unknown GUIDs are skipped silently', () => {
    const vp = {
      camera: { kind: 'perspective', position: [0, 0, 0], direction: [0, 0, -1], up: [0, 1, 0] },
      components: {
        selection: ['UNKNOWN'],
        visibility: { defaultVisibility: true, exceptions: [] },
      },
    } as any;

    const r = applyViewpoint(vp, frame, new Map(), new Map());
    expect(r.selectionDeviceIds).toEqual([]);
    expect(r.selectionExpressIds).toEqual([]);
  });
});
