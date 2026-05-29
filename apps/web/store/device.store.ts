import { create } from 'zustand';
import { DeviceDto } from '@nodescope/shared';
import { api } from '../lib/api.service';
import { drainOfflineQueue } from './offline-queue';
import { upsertById } from './upsert-by-id';
import { buildVersionedChangeset } from './version-changeset';

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
  | { type: 'create'; input: CreateDeviceInput; tempId: string }
  | { type: 'update'; deviceId: string; input: UpdateDeviceInput; previousDevice: DeviceDto }
  | { type: 'delete'; deviceId: string; previousDevice: DeviceDto };

interface DeviceStore {
  devices: DeviceDto[];
  isLoading: boolean;
  loaded: boolean;
  loadedAt: string | null;
  error: string | null;
  offlineQueue: OfflineOp[];

  setDevices: (devices: DeviceDto[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  upsertDevice: (device: DeviceDto) => void;
  removeDevice: (deviceId: string) => void;

  loadDevices: () => Promise<void>;
  createDevice: (input: CreateDeviceInput) => Promise<DeviceDto>;
  updateDevice: (deviceId: string, originalDevice: DeviceDto, input: UpdateDeviceInput) => Promise<DeviceDto>;
  deleteDevice: (deviceId: string) => Promise<void>;
  flushOfflineQueue: () => Promise<void>;
}

export const useDeviceStore = create<DeviceStore>((set, get) => ({
  devices: [],
  isLoading: false,
  loaded: false,
  loadedAt: null,
  error: null,
  offlineQueue: [],

  setDevices: (devices) => set({ devices, error: null }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  upsertDevice: (device) =>
    set((state) => ({ devices: upsertById(state.devices, device) })),

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
    const optimistic: DeviceDto = {
      id: tempId,
      userId: '',
      name: input.name,
      category: input.category,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      floor: input.floor ?? null,
      floorLabel: input.floorLabel ?? null,
      ipAddress: input.ipAddress ?? null,
      macAddress: input.macAddress ?? null,
      notes: input.notes ?? null,
      browserDeviceId: null,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    set((state) => ({ devices: [...state.devices, optimistic] }));

    try {
      const res = await api.post<{ success: true; data: DeviceDto }>('/devices', input);
      const created = res.data.data;
      set((state) => ({
        devices: state.devices.map((d) => (d.id === tempId ? created : d)),
      }));
      return created;
    } catch {
      set((state) => ({
        devices: state.devices.filter((d) => d.id !== tempId),
        offlineQueue: [...state.offlineQueue, { type: 'create', input, tempId }],
      }));
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
        offlineQueue: [
          ...state.offlineQueue,
          { type: 'update', deviceId, input, previousDevice: originalDevice },
        ],
      }));
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
      set((state) => ({
        devices: [...state.devices, current],
        offlineQueue: [
          ...state.offlineQueue,
          { type: 'delete', deviceId, previousDevice: current },
        ],
      }));
      throw new Error('Failed to delete device');
    }
  },

  flushOfflineQueue: () =>
    drainOfflineQueue(
      () => get().offlineQueue,
      () => set({ offlineQueue: [] }),
      (op) => {
        if (op.type === 'create') return get().createDevice(op.input);
        if (op.type === 'update') {
          return get().updateDevice(op.deviceId, op.previousDevice, op.input);
        }
        return get().deleteDevice(op.deviceId);
      },
    ),
}));
