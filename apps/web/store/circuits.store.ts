import { create } from 'zustand';
import { CircuitDto } from '@nodescope/shared';
import { api } from '../lib/api.service';

export interface CreateCircuitInput {
  ispName: string;
  circuitId?: string;
  serviceType: string;
  bandwidth?: number;
  deviceId?: string | null;
  notes?: string;
}

export interface UpdateCircuitInput {
  ispName?: string;
  circuitId?: string | null;
  serviceType?: string;
  bandwidth?: number | null;
  deviceId?: string | null;
  notes?: string | null;
}

type OfflineOp =
  | { type: 'create'; input: CreateCircuitInput; tempId: string }
  | { type: 'update'; circuitId: string; input: UpdateCircuitInput; previousCircuit: CircuitDto }
  | { type: 'delete'; circuitId: string; previousCircuit: CircuitDto };

interface CircuitStore {
  circuits: CircuitDto[];
  isLoading: boolean;
  loaded: boolean;
  loadedAt: string | null;
  error: string | null;
  nextCursor: string | null;
  total: number;
  offlineQueue: OfflineOp[];

  upsertCircuit: (circuit: CircuitDto) => void;
  removeCircuit: (circuitId: string) => void;

  loadCircuits: () => Promise<void>;
  loadNextPage: () => Promise<void>;
  createCircuit: (input: CreateCircuitInput) => Promise<CircuitDto>;
  updateCircuit: (
    circuitId: string,
    original: CircuitDto,
    input: UpdateCircuitInput,
  ) => Promise<CircuitDto>;
  deleteCircuit: (circuitId: string) => Promise<void>;
  flushOfflineQueue: () => Promise<void>;
}

export const useCircuitStore = create<CircuitStore>((set, get) => ({
  circuits: [],
  isLoading: false,
  loaded: false,
  loadedAt: null,
  error: null,
  nextCursor: null,
  total: 0,
  offlineQueue: [],

  upsertCircuit: (circuit) =>
    set((state) => {
      const idx = state.circuits.findIndex((c) => c.id === circuit.id);
      if (idx === -1) return { circuits: [...state.circuits, circuit] };
      const next = [...state.circuits];
      next[idx] = circuit;
      return { circuits: next };
    }),

  removeCircuit: (circuitId) =>
    set((state) => ({ circuits: state.circuits.filter((c) => c.id !== circuitId) })),

  loadCircuits: async () => {
    if (get().isLoading) return;
    set({ isLoading: true, error: null });
    try {
      const res = await api.get<{
        success: true;
        data: { items: CircuitDto[]; nextCursor: string | null; total: number };
      }>('/circuits?limit=50');
      set({
        circuits: res.data.data.items,
        nextCursor: res.data.data.nextCursor,
        total: res.data.data.total,
        isLoading: false,
        loaded: true,
        loadedAt: new Date().toISOString(),
      });
    } catch {
      set({ isLoading: false, error: 'Failed to load circuits' });
    }
  },

  loadNextPage: async () => {
    const { nextCursor, isLoading, circuits } = get();
    if (!nextCursor || isLoading) return;
    set({ isLoading: true });
    try {
      const res = await api.get<{
        success: true;
        data: { items: CircuitDto[]; nextCursor: string | null; total: number };
      }>(`/circuits?limit=50&cursor=${encodeURIComponent(nextCursor)}`);
      set({
        circuits: [...circuits, ...res.data.data.items],
        nextCursor: res.data.data.nextCursor,
        total: res.data.data.total,
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  createCircuit: async (input) => {
    const tempId = `temp-${Date.now()}`;
    const optimistic: CircuitDto = {
      id: tempId,
      userId: '',
      ispName: input.ispName,
      circuitId: input.circuitId ?? null,
      serviceType: input.serviceType,
      bandwidth: input.bandwidth ?? null,
      deviceId: input.deviceId ?? null,
      notes: input.notes ?? null,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    set((state) => ({ circuits: [optimistic, ...state.circuits] }));

    try {
      const res = await api.post<{ success: true; data: CircuitDto }>('/circuits', input);
      const created = res.data.data;
      set((state) => ({
        circuits: state.circuits.map((c) => (c.id === tempId ? created : c)),
        total: state.total + 1,
      }));
      return created;
    } catch {
      set((state) => ({
        circuits: state.circuits.filter((c) => c.id !== tempId),
        offlineQueue: [...state.offlineQueue, { type: 'create', input, tempId }],
      }));
      throw new Error('Failed to create circuit');
    }
  },

  updateCircuit: async (circuitId, original, input) => {
    const changes: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];
    for (const [field, newValue] of Object.entries(input)) {
      const oldValue = original[field as keyof CircuitDto];
      if (oldValue !== newValue) {
        changes.push({ field, oldValue, newValue });
      }
    }

    if (changes.length === 0) return original;

    const optimistic: CircuitDto = {
      ...original,
      ...input,
      updatedAt: new Date().toISOString(),
    } as CircuitDto;

    set((state) => ({
      circuits: state.circuits.map((c) => (c.id === circuitId ? optimistic : c)),
    }));

    try {
      const res = await api.patch<{ success: true; data: CircuitDto }>(`/circuits/${circuitId}`, {
        baseVersion: original.version,
        changes,
      });
      const updated = res.data.data;
      set((state) => ({
        circuits: state.circuits.map((c) => (c.id === circuitId ? updated : c)),
      }));
      return updated;
    } catch {
      set((state) => ({
        circuits: state.circuits.map((c) => (c.id === circuitId ? original : c)),
        offlineQueue: [
          ...state.offlineQueue,
          { type: 'update', circuitId, input, previousCircuit: original },
        ],
      }));
      throw new Error('Failed to update circuit');
    }
  },

  deleteCircuit: async (circuitId) => {
    const current = get().circuits.find((c) => c.id === circuitId);
    if (!current) return;

    set((state) => ({
      circuits: state.circuits.filter((c) => c.id !== circuitId),
      total: Math.max(0, state.total - 1),
    }));

    try {
      await api.delete(`/circuits/${circuitId}`);
    } catch {
      set((state) => ({
        circuits: [...state.circuits, current],
        total: state.total + 1,
        offlineQueue: [
          ...state.offlineQueue,
          { type: 'delete', circuitId, previousCircuit: current },
        ],
      }));
      throw new Error('Failed to delete circuit');
    }
  },

  flushOfflineQueue: async () => {
    const ops = get().offlineQueue;
    if (ops.length === 0) return;
    set({ offlineQueue: [] });

    for (const op of ops) {
      try {
        if (op.type === 'create') {
          await get().createCircuit(op.input);
        } else if (op.type === 'update') {
          await get().updateCircuit(op.circuitId, op.previousCircuit, op.input);
        } else if (op.type === 'delete') {
          await get().deleteCircuit(op.circuitId);
        }
      } catch {
        // Individual op failed; it re-queues itself
      }
    }
  },
}));
