import { create } from 'zustand';
import { MetricsDto } from '@nodescope/shared';

const STALE_THRESHOLD_MS = 90_000; // 3× the 30s push interval

interface RealtimeState {
  metrics: MetricsDto | null;
  sourceTypes: string[];
  setMetrics: (metrics: MetricsDto, sourceTypes: string[]) => void;
  isStale: () => boolean;
}

export const useRealtimeStore = create<RealtimeState>((set, get) => ({
  metrics: null,
  sourceTypes: [],

  setMetrics: (metrics, sourceTypes) => set({ metrics, sourceTypes }),

  isStale: () => {
    const { metrics } = get();
    if (!metrics) return true;
    return Date.now() - new Date(metrics.timestamp).getTime() > STALE_THRESHOLD_MS;
  },
}));
