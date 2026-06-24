import * as THREE from 'three';
import type { DeviceDto } from '@nodescope/shared';
import type { ParsedModel } from '../ifc/ifc-types';
import type { VisibilityState } from '../ifc/ifc-types';
import { useViewportStore } from '../../stores/viewport-store';
import { toModel } from './node-coords';

interface RestLike {
  setDevicePosition(id: string, pos: { x: number; y: number; z: number } | null): Promise<any>;
}

// On a rejected PATCH, restore ONLY the position fields to their prior values — preserving any
// non-position fields that may have arrived (e.g. a concurrent realtime update) since the optimistic write.
function rollbackPosition(deviceId: string, prev: DeviceDto): void {
  const store = useViewportStore.getState();
  const cur = store.devices.find((d) => d.id === deviceId);
  store.upsertDevice({ ...(cur ?? prev), x: prev.x, y: prev.y, z: prev.z });
}

/** World-space hit on the nearest VISIBLE building element under the ray, or null (no mid-air placement). */
export function raycastBuildingPoint(
  ray: THREE.Raycaster,
  model: ParsedModel,
  vis: VisibilityState,
): THREE.Vector3 | null {
  return model.render.pick(ray, vis)?.point ?? null;
}

/** Place/Move: world hit → native xyz → optimistic upsert + persist; rollback (and notify) on reject. */
export async function commitPlacement(
  deviceId: string,
  point: THREE.Vector3,
  deps: { rest: RestLike; frame: ParsedModel['frame']; notify?: (m: string) => void },
): Promise<void> {
  const store = useViewportStore.getState();
  const prev = store.devices.find((d) => d.id === deviceId);
  if (!prev) return;
  const xyz = toModel(point, deps.frame);
  store.upsertDevice({ ...prev, ...xyz });
  store.cancelPlace();
  try {
    store.upsertDevice(await deps.rest.setDevicePosition(deviceId, xyz));
  } catch (e) {
    rollbackPosition(deviceId, prev);
    deps.notify?.(`Couldn't place ${prev.name}: ${(e as Error).message}`);
  }
}

/** Clear: optimistic null + persist null; rollback (and notify) on reject. */
export async function clearPlacement(
  deviceId: string,
  deps: { rest: RestLike; notify?: (m: string) => void },
): Promise<void> {
  const store = useViewportStore.getState();
  const prev = store.devices.find((d) => d.id === deviceId);
  if (!prev) return;
  store.upsertDevice({ ...prev, x: null, y: null, z: null });
  try {
    store.upsertDevice(await deps.rest.setDevicePosition(deviceId, null));
  } catch (e) {
    rollbackPosition(deviceId, prev);
    deps.notify?.(`Couldn't clear ${prev.name}: ${(e as Error).message}`);
  }
}
