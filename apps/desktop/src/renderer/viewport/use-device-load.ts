import { useEffect } from 'react';
import type { DeviceDto, DeviceStatusDto, DeviceStatusState } from '@nodescope/shared';
import { WS_EVENTS } from '@nodescope/shared';
import { useViewportStore } from '../stores/viewport-store';
import { getClients } from '../data/clients';
import { statusFromState } from './nodes/node-status';

interface RestLike {
  listDevicesForBuilding(id: string): Promise<DeviceDto[]>;
  getAccessSummary?(): Promise<any>;
  getBuildingDeviceStatus?(id: string): Promise<DeviceStatusDto[]>;
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
 * Spec 7: seed the store's nodeStatus map from the building's device-status read.
 * Best-effort — on any failure markers simply stay 'unknown'. A stale resolve
 * (building switched) is discarded via isCurrent, matching loadDevicesFor.
 */
export async function loadStatusFor(
  propertyId: string,
  rest: { getBuildingDeviceStatus(id: string): Promise<{ deviceId: string; state: DeviceStatusState }[]> },
  isCurrent: () => boolean,
): Promise<void> {
  try {
    const rows = await rest.getBuildingDeviceStatus(propertyId);
    if (!isCurrent()) return;
    const store = useViewportStore.getState();
    for (const r of rows) store.setNodeStatus(r.deviceId, statusFromState(r.state));
  } catch {
    /* status is best-effort; markers stay 'unknown' */
  }
}

/** Spec 7: apply a v1:device:status realtime event into the store's nodeStatus map. */
export function applyStatusEvent(p: { deviceId: string; state: DeviceStatusState }): void {
  useViewportStore.getState().setNodeStatus(p.deviceId, statusFromState(p.state));
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
    const isCurrent = () =>
      active && useViewportStore.getState().activeBuildingPropertyId === propertyId;
    void loadDevicesFor(propertyId, rest, isCurrent);
    // Spec 7: seed live health status for the building's devices (best-effort).
    if (rest.getBuildingDeviceStatus) {
      void loadStatusFor(propertyId, rest as Required<Pick<RestLike, 'getBuildingDeviceStatus'>>, isCurrent);
    }
    return () => {
      active = false;
    };
  }, [propertyId]);

  useEffect(() => {
    const rt = getClients()?.realtime;
    if (!rt) return;
    const upd = (p: unknown) => applyDeviceEvent('updated', p as { deviceId: string; device: DeviceDto });
    const del = (p: unknown) => applyDeviceEvent('deleted', p as { deviceId: string });
    const status = (p: unknown) => applyStatusEvent(p as { deviceId: string; state: DeviceStatusState });
    rt.on(WS_EVENTS.DEVICE_UPDATED, upd);
    rt.on(WS_EVENTS.DEVICE_DELETED, del);
    rt.on(WS_EVENTS.DEVICE_STATUS, status);
    return () => {
      rt.off?.(WS_EVENTS.DEVICE_UPDATED, upd);
      rt.off?.(WS_EVENTS.DEVICE_DELETED, del);
      rt.off?.(WS_EVENTS.DEVICE_STATUS, status);
    };
  }, []);
}
