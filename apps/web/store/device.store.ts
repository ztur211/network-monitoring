import { create } from 'zustand';
import { DeviceDto } from '@nodescope/shared';

interface DeviceStore {
  devices: DeviceDto[];
  isLoading: boolean;
  error: string | null;
  setDevices: (devices: DeviceDto[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  upsertDevice: (device: DeviceDto) => void;
  removeDevice: (deviceId: string) => void;
}

export const useDeviceStore = create<DeviceStore>((set) => ({
  devices: [],
  isLoading: false,
  error: null,

  setDevices: (devices) => set({ devices, error: null }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  upsertDevice: (device) =>
    set((state) => {
      const idx = state.devices.findIndex((d) => d.id === device.id);
      if (idx === -1) return { devices: [...state.devices, device] };
      const next = [...state.devices];
      next[idx] = device;
      return { devices: next };
    }),

  removeDevice: (deviceId) =>
    set((state) => ({ devices: state.devices.filter((d) => d.id !== deviceId) })),
}));
