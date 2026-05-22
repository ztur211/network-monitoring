import { create } from 'zustand';
import { NetworkSummary } from '@nodescope/shared';
import { api } from '../lib/api.service';

interface NetworkStore {
  network: NetworkSummary | null;
  onHome: boolean;
  isLoading: boolean;
  loaded: boolean;
  error: string | null;

  setNetwork: (network: NetworkSummary | null) => void;
  setOnHome: (onHome: boolean) => void;
  load: () => Promise<void>;
}

export const useNetworkStore = create<NetworkStore>((set, get) => ({
  network: null,
  onHome: false,
  isLoading: false,
  loaded: false,
  error: null,

  setNetwork: (network) => set({ network }),

  setOnHome: (onHome) => set({ onHome }),

  load: async () => {
    if (get().isLoading) return;
    set({ isLoading: true, error: null });
    try {
      const res = await api.get<{ success: true; data: NetworkSummary[] }>('/networks');
      const network = res.data.data[0] ?? null;
      set({ network, isLoading: false, loaded: true });
    } catch {
      set({ isLoading: false, error: 'Failed to load network' });
    }
  },
}));
