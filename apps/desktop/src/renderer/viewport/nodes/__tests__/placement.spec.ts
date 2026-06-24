import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { commitPlacement, clearPlacement, raycastBuildingPoint } from '../placement';
import { toModel } from '../node-coords';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';
import { createModelRender } from '../../ifc/model-render';
import type { MergedCategory } from '../../ifc/merge';

const frame = { recenter: new THREE.Vector3(), upConversion: 'Z_UP_TO_Y_UP' as const };
const dev = (id: string, over = {}) =>
  ({ id, name: id, category: 'SWITCH', propertyId: 'b', networkId: 'n', x: null, y: null, z: null, ...over }) as any;

// merge reset so the store action fns survive
beforeEach(() => {
  useViewportStore.setState(initialViewportState());
  useViewportStore.getState().setDevices([dev('a')]);
  useViewportStore.getState().beginPlace('a');
});

function cat(ifcType: string, expressIDs: number[]): MergedCategory {
  const position: number[] = [];
  const index: number[] = [];
  const ranges = expressIDs.map((expressID, e) => {
    const base = e * 3;
    position.push(base, 0, 0, base + 1, 0, 0, base, 1, 0);
    index.push(base, base + 1, base + 2);
    return { expressID, indexStart: e * 3, indexCount: 3 };
  });
  return { ifcType, position: new Float32Array(position), normal: new Float32Array(position.length),
    color: new Float32Array(position.length).fill(1), index: new Uint32Array(index), ranges };
}

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
    const model = { render: createModelRender([cat('IfcWall', [1])]) } as any;
    const ray = new THREE.Raycaster(new THREE.Vector3(0.2, 0.2, 5), new THREE.Vector3(0, 0, -1));
    const vis = { hiddenCategories: new Set<string>(), hiddenElements: new Set<number>(), isolated: null as number | null };
    const point = raycastBuildingPoint(ray, model, vis);
    expect(point).not.toBeNull();
    expect(point!.z).toBeCloseTo(0, 5);
  });
});
