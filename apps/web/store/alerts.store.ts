import { create } from 'zustand';
import type { AlertEventDto } from '@nodescope/shared';

/**
 * The alerts feed store. Holds a capped, newest-first list of alert events:
 * seeded once via `setInitial` (GET /alerts/events) and pushed to in realtime
 * by alert-events.service's v1:alert:fired/resolved subscriptions.
 */
const CAP = 200;

interface AlertsState {
  events: AlertEventDto[];
  setInitial: (list: AlertEventDto[]) => void;
  prepend: (item: AlertEventDto) => void;
  reset: () => void;
}

export const useAlertsStore = create<AlertsState>((set) => ({
  events: [],
  setInitial: (list) => set({ events: list.slice(0, CAP) }),
  prepend: (item) => set((s) => ({ events: [item, ...s.events].slice(0, CAP) })),
  reset: () => set({ events: [] }),
}));
