import type { DeviceDto } from '@nodescope/shared';
import { useViewportStore } from '../../stores/viewport-store';

interface RestLike {
  setDeviceIfcLink(id: string, ifcGlobalId: string | null): Promise<DeviceDto>;
}

// On a rejected PATCH, restore ONLY ifcGlobalId to its prior value — preserving any non-link fields
// that may have arrived (e.g. a concurrent realtime update) since the optimistic write.
function rollbackLink(deviceId: string, prev: DeviceDto): void {
  const store = useViewportStore.getState();
  const cur = store.devices.find((d) => d.id === deviceId);
  store.upsertDevice({ ...(cur ?? prev), ifcGlobalId: prev.ifcGlobalId });
}

/** Link a device to a BIM element by its GlobalId: optimistic upsert + persist; rollback (and notify) on reject. */
export async function commitLink(
  deviceId: string,
  ifcGlobalId: string,
  deps: { rest: RestLike; notify?: (m: string) => void },
): Promise<void> {
  const store = useViewportStore.getState();
  const prev = store.devices.find((d) => d.id === deviceId);
  if (!prev) return;
  store.upsertDevice({ ...prev, ifcGlobalId });
  store.cancelLink();
  try {
    store.upsertDevice(await deps.rest.setDeviceIfcLink(deviceId, ifcGlobalId));
  } catch (e) {
    rollbackLink(deviceId, prev);
    deps.notify?.(`Couldn't link ${prev.name}: ${(e as Error).message}`);
  }
}

/** Clear a device's BIM link: optimistic null + persist null; rollback (and notify) on reject. */
export async function clearLink(
  deviceId: string,
  deps: { rest: RestLike; notify?: (m: string) => void },
): Promise<void> {
  const store = useViewportStore.getState();
  const prev = store.devices.find((d) => d.id === deviceId);
  if (!prev) return;
  store.upsertDevice({ ...prev, ifcGlobalId: null });
  try {
    store.upsertDevice(await deps.rest.setDeviceIfcLink(deviceId, null));
  } catch (e) {
    rollbackLink(deviceId, prev);
    deps.notify?.(`Couldn't unlink ${prev.name}: ${(e as Error).message}`);
  }
}
