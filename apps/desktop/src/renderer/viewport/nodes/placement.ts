import * as THREE from 'three';
import type { ParsedModel } from '../ifc/ifc-types';
import { isMeshVisible, type VisibilityState } from '../interaction/visibility';
import { useViewportStore } from '../../stores/viewport-store';
import { toModel } from './node-coords';

interface RestLike {
  setDevicePosition(id: string, pos: { x: number; y: number; z: number } | null): Promise<any>;
}

/** World-space hit on the nearest VISIBLE building mesh under the ray, or null (no mid-air placement). */
export function raycastBuildingPoint(
  ray: THREE.Raycaster,
  model: ParsedModel,
  vis: VisibilityState,
): THREE.Vector3 | null {
  const meshes = [...model.elementIndex.values()].filter((m) => isMeshVisible(m, vis));
  const hits = ray.intersectObjects(meshes, false);
  return hits.length ? hits[0].point.clone() : null;
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
    store.upsertDevice(prev);
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
    store.upsertDevice(prev);
    deps.notify?.(`Couldn't clear ${prev.name}: ${(e as Error).message}`);
  }
}
