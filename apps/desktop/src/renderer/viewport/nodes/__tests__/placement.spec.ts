import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { commitPlacement, clearPlacement, raycastBuildingPoint } from '../placement';
import { toModel } from '../node-coords';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';

const frame = { recenter: new THREE.Vector3(), upConversion: 'Z_UP_TO_Y_UP' as const };
const dev = (id: string, over = {}) =>
  ({ id, name: id, category: 'SWITCH', propertyId: 'b', networkId: 'n', x: null, y: null, z: null, ...over }) as any;

// merge reset so the store action fns survive
beforeEach(() => {
  useViewportStore.setState(initialViewportState());
  useViewportStore.getState().setDevices([dev('a')]);
  useViewportStore.getState().beginPlace('a');
});

describe('commitPlacement', () => {
  it('converts the hit to native xyz, persists, upserts the result, and exits placing mode', async () => {
    const point = new THREE.Vector3(1, 2, 3);
    const native = toModel(point, frame); // world hit → native (Z-up) coords
    const rest = { setDevicePosition: vi.fn().mockResolvedValue(dev('a', native)) };
    await commitPlacement('a', point, { rest: rest as any, frame });
    const d = useViewportStore.getState().devices[0];
    expect([d.x, d.y, d.z]).toEqual([native.x, native.y, native.z]);
    expect(useViewportStore.getState().placingDeviceId).toBeNull();
    expect(rest.setDevicePosition).toHaveBeenCalledWith('a', native);
  });

  it('rolls back to the prior position on rejection and notifies', async () => {
    const rest = {
      setDevicePosition: vi.fn().mockRejectedValue(Object.assign(new Error('no'), { code: 'PERM_001' })),
    };
    const notify = vi.fn();
    await commitPlacement('a', new THREE.Vector3(5, 6, 7), { rest: rest as any, frame, notify });
    const d = useViewportStore.getState().devices[0];
    expect([d.x, d.y, d.z]).toEqual([null, null, null]); // rolled back to prev
    expect(notify).toHaveBeenCalled();
  });
});

describe('clearPlacement', () => {
  it('clears xyz optimistically and persists null', async () => {
    useViewportStore.getState().upsertDevice(dev('a', { x: 1, y: 2, z: 3 }));
    const rest = { setDevicePosition: vi.fn().mockResolvedValue(dev('a')) };
    await clearPlacement('a', { rest: rest as any });
    expect(useViewportStore.getState().devices[0].x).toBeNull();
    expect(rest.setDevicePosition).toHaveBeenCalledWith('a', null);
  });
});

describe('raycastBuildingPoint', () => {
  it('returns the world hit on a visible mesh, null on miss', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    mesh.userData = { expressID: 1, ifcType: 'IFCWALL' };
    const model = { elementIndex: new Map([[1, mesh]]) } as any;
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    cam.position.set(0, 0, 10);
    cam.lookAt(0, 0, 0);
    const vis = { hiddenCategories: new Set<string>(), hiddenElements: new Set<number>(), isolated: null };
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), cam);
    expect(raycastBuildingPoint(ray, model, vis)!.z).toBeCloseTo(1, 1); // front face of the box
    const miss = new THREE.Raycaster();
    miss.setFromCamera(new THREE.Vector2(0.99, 0.99), cam);
    expect(raycastBuildingPoint(miss, model, vis)).toBeNull();
  });
});
