import { create } from 'zustand';
import { NetworkDetail, NetworkSummary } from '@nodescope/shared';
import { api } from '../lib/api.service';

interface NetworkStore {
  network: NetworkSummary | null;
  onHome: boolean;
  isLoading: boolean;
  loaded: boolean;
  error: string | null;
  savingHomeIp: boolean;
  setHomeIpError: string | null;

  setNetwork: (network: NetworkSummary | null) => void;
  setOnHome: (onHome: boolean) => void;
  load: () => Promise<void>;
  setHomeIp: () => Promise<void>;
}

export const useNetworkStore = create<NetworkStore>((set, get) => ({
  network: null,
  onHome: false,
  isLoading: false,
  loaded: false,
  error: null,
  savingHomeIp: false,
  setHomeIpError: null,

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

  setHomeIp: async () => {
    const { network, savingHomeIp } = get();
    if (!network || savingHomeIp) return;
    set({ savingHomeIp: true, setHomeIpError: null });
    try {
      const res = await api.post<{ success: true; data: NetworkDetail }>(
        `/networks/${network.id}/set-home-ip`,
      );
      // Strip homePublicIp before caching — store holds NetworkSummary, list
      // endpoints omit it too. Mirrors network-events.service.
      const { homePublicIp: _homePublicIp, ...summary } = res.data.data;
      set({ network: summary as NetworkSummary, savingHomeIp: false });
    } catch {
      set({ savingHomeIp: false, setHomeIpError: 'Failed to save home IP' });
    }
  },
}));
