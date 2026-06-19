import { useEffect } from 'react';
import type { DeviceDto } from '@nodescope/shared';
import { WS_EVENTS } from '@nodescope/shared';
import { useViewportStore } from '../stores/viewport-store';
import { getClients } from '../data/clients';

interface RestLike {
  listDevicesForBuilding(id: string): Promise<DeviceDto[]>;
  getAccessSummary?(): Promise<any>;
}

/** Load a building's devices into the store; a stale resolve (building switched) is discarded. */
export async function loadDevicesFor(
  propertyId: string,
  rest: RestLike,
  isCurrent: () => boolean,
): Promise<void> {
  try {
    const ds = await rest.listDevicesForBuilding(propertyId);
    if (isCurrent()) useViewportStore.getState().setDevices(ds);
  } catch {
    if (isCurrent()) useViewportStore.getState().setDevices([]);
  }
}

/**
 * Patch the store from a realtime device event, using the API's wire envelopes
 * (`devices.service`): DEVICE_UPDATED → `{ deviceId, device }`, DEVICE_DELETED → `{ deviceId }`.
 * Live-updates only ALREADY-listed devices (a newly created device enters the list on the next
 * building switch; device CRUD stays the existing API).
 */
export function applyDeviceEvent(
  kind: 'updated' | 'deleted',
  payload: { deviceId: string; device?: DeviceDto },
): void {
  const store = useViewportStore.getState();
  if (kind === 'deleted') {
    store.removeDevice(payload.deviceId);
    return;
  }
  const d = payload.device;
  if (d && store.devices.some((x) => x.id === d.id)) store.upsertDevice(d);
}

/** Load the building's devices (+ the caller's access once) and keep the list live via realtime. */
export function useDeviceLoad(): void {
  const propertyId = useViewportStore((s) => s.activeBuildingPropertyId);

  useEffect(() => {
    getClients()
      ?.rest?.getAccessSummary?.()
      .then((a) => useViewportStore.getState().setAccess(a))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const rest = getClients()?.rest as RestLike | undefined;
    if (!propertyId || !rest) {
      useViewportStore.getState().setDevices([]);
      return;
    }
    let active = true;
    void loadDevicesFor(
      propertyId,
      rest,
      () => active && useViewportStore.getState().activeBuildingPropertyId === propertyId,
    );
    return () => {
      active = false;
    };
  }, [propertyId]);

  useEffect(() => {
    const rt = getClients()?.realtime;
    if (!rt) return;
    const upd = (p: unknown) => applyDeviceEvent('updated', p as { deviceId: string; device: DeviceDto });
    const del = (p: unknown) => applyDeviceEvent('deleted', p as { deviceId: string });
    rt.on(WS_EVENTS.DEVICE_UPDATED, upd);
    rt.on(WS_EVENTS.DEVICE_DELETED, del);
    return () => {
      rt.off?.(WS_EVENTS.DEVICE_UPDATED, upd);
      rt.off?.(WS_EVENTS.DEVICE_DELETED, del);
    };
  }, []);
}
