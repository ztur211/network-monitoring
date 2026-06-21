import { create } from 'zustand';
import { DeviceDto } from '@nodescope/shared';
import { api } from '../lib/api.service';
import {
  drainOfflineQueue,
  loadPersistedQueue,
  newIdempotencyKey,
  persistQueue,
  type GiveUpReason,
} from './offline-queue';
import { upsertById } from './upsert-by-id';
import { buildVersionedChangeset } from './version-changeset';

const OFFLINE_QUEUE_KEY = 'ns:offlineQueue:devices';

export interface CreateDeviceInput {
  name: string;
  category: string;
  latitude?: number;
  longitude?: number;
  floor?: number;
  floorLabel?: string;
  ipAddress?: string;
  macAddress?: string;
  notes?: string;
}

export interface UpdateDeviceInput {
  name?: string;
  category?: string;
  latitude?: number | null;
  longitude?: number | null;
  floor?: number | null;
  floorLabel?: string | null;
  ipAddress?: string | null;
  macAddress?: string | null;
  notes?: string | null;
}

type OfflineOp =
  | { type: 'create'; input: CreateDeviceInput; tempId: string; idempotencyKey: string; attempts: number }
  | { type: 'update'; deviceId: string; input: UpdateDeviceInput; previousDevice: DeviceDto; attempts: number }
  | { type: 'delete'; deviceId: string; previousDevice: DeviceDto; attempts: number };

interface DeviceStore {
  devices: DeviceDto[];
  isLoading: boolean;
  loaded: boolean;
  loadedAt: string | null;
  error: string | null;
  offlineQueue: OfflineOp[];
  offlineSyncError: string | null;
  flushing: boolean;

  setDevices: (devices: DeviceDto[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  upsertDevice: (device: DeviceDto) => void;
  upsertManyDevices: (devices: DeviceDto[]) => void;
  removeDevice: (deviceId: string) => void;
  clearOfflineSyncError: () => void;

  loadDevices: () => Promise<void>;
  createDevice: (input: CreateDeviceInput) => Promise<DeviceDto>;
  updateDevice: (deviceId: string, originalDevice: DeviceDto, input: UpdateDeviceInput) => Promise<DeviceDto>;
  deleteDevice: (deviceId: string) => Promise<void>;
  flushOfflineQueue: () => Promise<void>;
}

function describeGiveUp(op: OfflineOp, reason: GiveUpReason): string {
  const verb = op.type === 'create' ? 'add' : op.type === 'update' ? 'update' : 'delete';
  return reason === 'conflict'
    ? `Couldn't ${verb} a device — it changed somewhere else. Reload to see the latest.`
    : `Couldn't ${verb} a device after several attempts. Please try again.`;
}

export const useDeviceStore = create<DeviceStore>((set, get) => {
  const setOfflineQueue = (offlineQueue: OfflineOp[]) => {
    persistQueue(OFFLINE_QUEUE_KEY, offlineQueue);
    set({ offlineQueue });
  };

  const enqueue = (op: OfflineOp) =>
    set((state) => {
      const offlineQueue = [...state.offlineQueue, op];
      persistQueue(OFFLINE_QUEUE_KEY, offlineQueue);
      return { offlineQueue };
    });

  // Replays one queued op WITHOUT re-enqueueing on failure — drainOfflineQueue
  // owns the requeue/give-up decision. Throws on failure so the drain can
  // classify the error (conflict vs transient).
  const replayOp = async (op: OfflineOp): Promise<void> => {
    if (op.type === 'create') {
      const res = await api.post<{ success: true; data: DeviceDto }>('/devices', op.input, {
        headers: { 'Idempotency-Key': op.idempotencyKey },
      });
      get().upsertDevice(res.data.data);
      return;
    }
    if (op.type === 'update') {
      const changes = buildVersionedChangeset(op.previousDevice, op.input);
      const res = await api.patch<{ success: true; data: DeviceDto }>(`/devices/${op.deviceId}`, {
        baseVersion: op.previousDevice.version,
        changes,
      });
      get().upsertDevice(res.data.data);
      return;
    }
    await api.delete(`/devices/${op.deviceId}`);
    get().removeDevice(op.deviceId);
  };

  return {
    devices: [],
    isLoading: false,
    loaded: false,
    loadedAt: null,
    error: null,
    offlineQueue: loadPersistedQueue<OfflineOp>(OFFLINE_QUEUE_KEY),
    offlineSyncError: null,
    flushing: false,

    setDevices: (devices) => set({ devices, error: null }),
    setLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error }),
    clearOfflineSyncError: () => set({ offlineSyncError: null }),

    upsertDevice: (device) =>
      set((state) => ({ devices: upsertById(state.devices, device) })),

    // Merge many devices in ONE state update (one render). The map's viewport load
    // previously called upsertDevice per device — a React render per returned device.
    upsertManyDevices: (incoming) =>
      set((state) =>
        incoming.length === 0
          ? {}
          : { devices: incoming.reduce((acc, d) => upsertById(acc, d), state.devices) },
      ),

    removeDevice: (deviceId) =>
      set((state) => ({ devices: state.devices.filter((d) => d.id !== deviceId) })),

    loadDevices: async () => {
      if (get().isLoading) return;
      set({ isLoading: true, error: null });
      try {
        const res = await api.get<{ success: true; data: { items: DeviceDto[]; total: number } }>(
          '/devices',
        );
        set({ devices: res.data.data.items, isLoading: false, loaded: true, loadedAt: new Date().toISOString() });
      } catch {
        set({ isLoading: false, error: 'Failed to load devices' });
      }
    },

    createDevice: async (input) => {
      const tempId = `temp-${Date.now()}`;
      const idempotencyKey = newIdempotencyKey();
      const optimistic: DeviceDto = {
        id: tempId,
        userId: '',
        // Placeholder scope/3D fields for the optimistic row only; the POST
        // response replaces this object with the server's persisted values.
        networkId: '',
        propertyId: '',
        roleCode: null,
        name: input.name,
        category: input.category,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        floor: input.floor ?? null,
        floorLabel: input.floorLabel ?? null,
        x: null,
        y: null,
        z: null,
        ipAddress: input.ipAddress ?? null,
        macAddress: input.macAddress ?? null,
        notes: input.notes ?? null,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      set((state) => ({ devices: [...state.devices, optimistic] }));

      try {
        const res = await api.post<{ success: true; data: DeviceDto }>('/devices', input, {
          headers: { 'Idempotency-Key': idempotencyKey },
        });
        const created = res.data.data;
        set((state) => ({
          devices: state.devices.map((d) => (d.id === tempId ? created : d)),
        }));
        return created;
      } catch {
        set((state) => ({ devices: state.devices.filter((d) => d.id !== tempId) }));
        enqueue({ type: 'create', input, tempId, idempotencyKey, attempts: 0 });
        throw new Error('Failed to create device');
      }
    },

    updateDevice: async (deviceId, originalDevice, input) => {
      const changes = buildVersionedChangeset(originalDevice, input);
      if (changes.length === 0) return originalDevice;

      const optimistic: DeviceDto = {
        ...originalDevice,
        ...input,
        updatedAt: new Date().toISOString(),
      } as DeviceDto;

      set((state) => ({
        devices: state.devices.map((d) => (d.id === deviceId ? optimistic : d)),
      }));

      try {
        const patchPayload = { baseVersion: originalDevice.version, changes };
        const res = await api.patch<{ success: true; data: DeviceDto }>(
          `/devices/${deviceId}`,
          patchPayload,
        );
        const updated = res.data.data;
        set((state) => ({
          devices: state.devices.map((d) => (d.id === deviceId ? updated : d)),
        }));
        return updated;
      } catch {
        set((state) => ({
          devices: state.devices.map((d) => (d.id === deviceId ? originalDevice : d)),
        }));
        enqueue({ type: 'update', deviceId, input, previousDevice: originalDevice, attempts: 0 });
        throw new Error('Failed to update device');
      }
    },

    deleteDevice: async (deviceId) => {
      const current = get().devices.find((d) => d.id === deviceId);
      if (!current) return;

      set((state) => ({ devices: state.devices.filter((d) => d.id !== deviceId) }));

      try {
        await api.delete(`/devices/${deviceId}`);
      } catch {
        set((state) => ({ devices: [...state.devices, current] }));
        enqueue({ type: 'delete', deviceId, previousDevice: current, attempts: 0 });
        throw new Error('Failed to delete device');
      }
    },

    flushOfflineQueue: async () => {
      // In-flight guard: 'connect' and 'reconnect' can both fire on one recovery;
      // without this the two drains would race over the same queue snapshot.
      if (get().flushing) return;
      set({ flushing: true });
      try {
        await drainOfflineQueue<OfflineOp>(
          () => get().offlineQueue,
          (ops) => setOfflineQueue(ops),
          (op) => replayOp(op),
          (op, reason) => set({ offlineSyncError: describeGiveUp(op, reason) }),
        );
      } finally {
        set({ flushing: false });
      }
    },
  };
});
