import { create } from 'zustand';
import { ConnectionStatus, DeviceCategory } from '@nodescope/shared';

const ALL_CATEGORIES: DeviceCategory[] = [
  'RAD', 'ONT', 'DSLAM', 'ROUTER', 'MODEM', 'FIBER_MEDIA_CONVERTER', 'FIREWALL',
  'SWITCH', 'ACCESS_POINT', 'WIFI_EXTENDER', 'WIRELESS_BRIDGE', 'SERVER_RACK',
  'PATCH_PANEL', 'UPS', 'COMPUTER', 'PHONE', 'TABLET', 'PRINTER', 'IOT_DEVICE', 'CUSTOM',
];

const DEFAULT_LAYER_TOGGLES = Object.fromEntries(
  ALL_CATEGORIES.map((c) => [c, true]),
) as Record<DeviceCategory, boolean>;

export type FloorDisplayMode = 'single' | 'all' | 'connection';

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage quota exceeded — silently ignore
  }
}

interface UiStore {
  connectionStatus: ConnectionStatus;
  latency: number | null;
  lastContactAt: string | null;

  mapCenter: [number, number] | null;
  mapZoom: number;
  layerToggles: Record<DeviceCategory, boolean>;
  selectedFloor: number | null;
  floorDisplayMode: FloorDisplayMode;
  buildingsVisible: boolean;

  setConnectionStatus: (status: ConnectionStatus) => void;
  setLatency: (latency: number) => void;
  setMapCenter: (center: [number, number]) => void;
  setMapZoom: (zoom: number) => void;
  setLayerToggle: (category: DeviceCategory, visible: boolean) => void;
  setSelectedFloor: (floor: number | null) => void;
  setFloorDisplayMode: (mode: FloorDisplayMode) => void;
  setBuildingsVisible: (visible: boolean) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  connectionStatus: 'offline',
  latency: null,
  lastContactAt: null,

  mapCenter: loadFromStorage<[number, number] | null>('ns:mapCenter', null),
  mapZoom: loadFromStorage<number>('ns:mapZoom', 13),
  buildingsVisible: loadFromStorage<boolean>('ns:buildingsVisible', true),
  layerToggles: loadFromStorage<Record<DeviceCategory, boolean>>(
    'ns:layerToggles',
    DEFAULT_LAYER_TOGGLES,
  ),
  selectedFloor: null,
  floorDisplayMode: 'all',

  setConnectionStatus: (connectionStatus) =>
    set((state) => ({
      connectionStatus,
      lastContactAt:
        connectionStatus === 'connected' ? new Date().toISOString() : state.lastContactAt,
    })),

  setLatency: (latency) => set({ latency, lastContactAt: new Date().toISOString() }),

  setMapCenter: (mapCenter) => {
    saveToStorage('ns:mapCenter', mapCenter);
    set({ mapCenter });
  },

  setMapZoom: (mapZoom) => {
    saveToStorage('ns:mapZoom', mapZoom);
    set({ mapZoom });
  },

  setLayerToggle: (category, visible) =>
    set((state) => {
      const layerToggles = { ...state.layerToggles, [category]: visible };
      saveToStorage('ns:layerToggles', layerToggles);
      return { layerToggles };
    }),

  setSelectedFloor: (selectedFloor) => set({ selectedFloor }),
  setFloorDisplayMode: (floorDisplayMode) => set({ floorDisplayMode }),
  setBuildingsVisible: (buildingsVisible) => {
    saveToStorage('ns:buildingsVisible', buildingsVisible);
    set({ buildingsVisible });
  },
}));
