import { create } from 'zustand';
import { ConnectionStatus, DeviceCategory, MapPreferences, FloorDisplayMode } from '@nodescope/shared';
import { api } from '../lib/api.service';

const ALL_CATEGORIES: DeviceCategory[] = [
  'RAD', 'ONT', 'DSLAM', 'ROUTER', 'MODEM', 'FIBER_MEDIA_CONVERTER', 'FIREWALL',
  'SWITCH', 'ACCESS_POINT', 'WIFI_EXTENDER', 'WIRELESS_BRIDGE', 'SERVER_RACK',
  'PATCH_PANEL', 'UPS', 'COMPUTER', 'PHONE', 'TABLET', 'PRINTER', 'IOT_DEVICE', 'CUSTOM',
];

const DEFAULT_LAYER_TOGGLES = Object.fromEntries(
  ALL_CATEGORIES.map((c) => [c, true]),
) as Record<DeviceCategory, boolean>;

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
  mapPreferencesDirty: boolean;

  setConnectionStatus: (status: ConnectionStatus) => void;
  setLatency: (latency: number) => void;
  setMapCenter: (center: [number, number]) => void;
  setMapZoom: (zoom: number) => void;
  setLayerToggle: (category: DeviceCategory, visible: boolean) => void;
  setSelectedFloor: (floor: number | null) => void;
  setFloorDisplayMode: (mode: FloorDisplayMode) => void;
  setBuildingsVisible: (visible: boolean) => void;
  syncPreferencesFromServer: () => Promise<void>;
  flushMapPreferences: () => Promise<void>;
}

const KNOWN_PHASE1_KEYS = [
  'ns:mapCenter',
  'ns:mapZoom',
  'ns:layerToggles',
  'ns:buildingsVisible',
];

function hasAnyPhase1LocalStorage(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return KNOWN_PHASE1_KEYS.some((k) => localStorage.getItem(k) !== null);
}

function collectCurrentPreferences(state: UiStore): MapPreferences {
  return {
    buildingsVisible: state.buildingsVisible,
    layerToggles: state.layerToggles,
    ...(state.mapCenter ? { mapCenter: state.mapCenter } : {}),
    mapZoom: state.mapZoom,
    selectedFloor: state.selectedFloor,
    floorDisplayMode: state.floorDisplayMode,
  };
}

let putDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function enqueuePutPreferences(getState: () => UiStore, setState: (partial: Partial<UiStore>) => void): void {
  if (putDebounceTimer) clearTimeout(putDebounceTimer);
  putDebounceTimer = setTimeout(async () => {
    putDebounceTimer = null;
    const payload = collectCurrentPreferences(getState());
    try {
      await api.put('/users/me/preferences', payload);
      setState({ mapPreferencesDirty: false });
    } catch {
      // Network or server error — leave dirty flag set; reconnect handler will retry.
    }
  }, 500);
}

function markDirtyAndEnqueue(getState: () => UiStore, setState: (partial: Partial<UiStore>) => void): void {
  saveToStorage('ns:mapPreferencesDirty', true);
  setState({ mapPreferencesDirty: true });
  enqueuePutPreferences(getState, setState);
}

export const useUiStore = create<UiStore>((set, get) => ({
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
  selectedFloor: loadFromStorage<number | null>('ns:selectedFloor', null),
  floorDisplayMode: loadFromStorage<FloorDisplayMode>('ns:floorDisplayMode', 'all'),
  mapPreferencesDirty: loadFromStorage<boolean>('ns:mapPreferencesDirty', false),

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
    markDirtyAndEnqueue(get, set);
  },

  setMapZoom: (mapZoom) => {
    saveToStorage('ns:mapZoom', mapZoom);
    set({ mapZoom });
    markDirtyAndEnqueue(get, set);
  },

  setLayerToggle: (category, visible) => {
    set((state) => {
      const layerToggles = { ...state.layerToggles, [category]: visible };
      saveToStorage('ns:layerToggles', layerToggles);
      return { layerToggles };
    });
    markDirtyAndEnqueue(get, set);
  },

  setSelectedFloor: (selectedFloor) => {
    saveToStorage('ns:selectedFloor', selectedFloor);
    set({ selectedFloor });
    markDirtyAndEnqueue(get, set);
  },

  setFloorDisplayMode: (floorDisplayMode) => {
    saveToStorage('ns:floorDisplayMode', floorDisplayMode);
    set({ floorDisplayMode });
    markDirtyAndEnqueue(get, set);
  },

  setBuildingsVisible: (buildingsVisible) => {
    saveToStorage('ns:buildingsVisible', buildingsVisible);
    set({ buildingsVisible });
    markDirtyAndEnqueue(get, set);
  },

  syncPreferencesFromServer: async () => {
    try {
      const res = await api.get<{ success: true; data: { preferences: MapPreferences } }>(
        '/users/me/preferences',
      );
      const serverPrefs = res.data.data.preferences ?? {};
      const state = get();

      // Local-wins path: if there are pending offline changes, push local → server now.
      if (state.mapPreferencesDirty) {
        await api
          .put('/users/me/preferences', collectCurrentPreferences(state))
          .then(() => {
            saveToStorage('ns:mapPreferencesDirty', false);
            set({ mapPreferencesDirty: false });
          })
          .catch(() => {
            // PUT failed — leave dirty flag; reconnect handler retries.
          });
        return;
      }

      // Migration path: if server is empty but local has Phase-1 keys, push local one-shot.
      const serverIsEmpty = Object.keys(serverPrefs).length === 0;
      if (serverIsEmpty && hasAnyPhase1LocalStorage()) {
        await api
          .put('/users/me/preferences', collectCurrentPreferences(state))
          .catch(() => {/* leave dirty=false; next change will retry */});
        return;
      }

      // Server-wins path: reconcile fields the server has set into the store.
      const patch: Partial<UiStore> = {};
      if (serverPrefs.buildingsVisible !== undefined) {
        saveToStorage('ns:buildingsVisible', serverPrefs.buildingsVisible);
        patch.buildingsVisible = serverPrefs.buildingsVisible;
      }
      if (serverPrefs.layerToggles !== undefined) {
        saveToStorage('ns:layerToggles', serverPrefs.layerToggles);
        patch.layerToggles = serverPrefs.layerToggles as Record<DeviceCategory, boolean>;
      }
      if (serverPrefs.mapCenter !== undefined) {
        saveToStorage('ns:mapCenter', serverPrefs.mapCenter);
        patch.mapCenter = serverPrefs.mapCenter;
      }
      if (serverPrefs.mapZoom !== undefined) {
        saveToStorage('ns:mapZoom', serverPrefs.mapZoom);
        patch.mapZoom = serverPrefs.mapZoom;
      }
      if (serverPrefs.selectedFloor !== undefined) {
        saveToStorage('ns:selectedFloor', serverPrefs.selectedFloor);
        patch.selectedFloor = serverPrefs.selectedFloor;
      }
      if (serverPrefs.floorDisplayMode !== undefined) {
        saveToStorage('ns:floorDisplayMode', serverPrefs.floorDisplayMode);
        patch.floorDisplayMode = serverPrefs.floorDisplayMode;
      }
      set(patch);
    } catch {
      // GET failed — stay on localStorage. Reconnect handler will retry.
    }
  },

  flushMapPreferences: async () => {
    if (!get().mapPreferencesDirty) return;
    try {
      await api.put('/users/me/preferences', collectCurrentPreferences(get()));
      saveToStorage('ns:mapPreferencesDirty', false);
      set({ mapPreferencesDirty: false });
    } catch {
      // Leave dirty; next reconnect will retry again.
    }
  },
}));
