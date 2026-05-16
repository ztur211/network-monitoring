import { create } from 'zustand';
import { ConnectionStatus } from '@nodescope/shared';

interface UiStore {
  connectionStatus: ConnectionStatus;
  latency: number | null;
  lastContactAt: string | null;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setLatency: (latency: number) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  connectionStatus: 'offline',
  latency: null,
  lastContactAt: null,

  setConnectionStatus: (connectionStatus) =>
    set((state) => ({
      connectionStatus,
      lastContactAt:
        connectionStatus === 'connected'
          ? new Date().toISOString()
          : state.lastContactAt,
    })),

  setLatency: (latency) =>
    set({ latency, lastContactAt: new Date().toISOString() }),
}));
