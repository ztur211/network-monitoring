import { create } from 'zustand';
import type { ParsedModel, IfcType, ExpressId } from '../viewport/ifc/ifc-types';

export type ViewportStatus = 'idle' | 'loading' | 'parsing' | 'ready' | 'empty' | 'error';
export interface SectionState {
  enabled: boolean;
  axis: 'X' | 'Y' | 'Z';
  constant: number;
}

export interface ViewportState {
  // from Spec 2:
  activeBuildingPropertyId: string | null;
  setActiveBuilding: (id: string | null) => void;
  // Spec 3 lifecycle:
  status: ViewportStatus;
  error: string | null;
  model: ParsedModel | null;
  reloadNonce: number;
  updateAvailable: boolean;
  fitNonce: number;
  focusNonce: number;
  // Spec 3 interaction state (the Spec 3 boundary Spec 4 also writes onto):
  selection: ExpressId | null;
  hiddenCategories: Set<IfcType>;
  isolated: ExpressId | null;
  hiddenElements: Set<ExpressId>;
  section: SectionState;
  // actions:
  select: (id: ExpressId | null) => void;
  isolate: (id: ExpressId) => void;
  clearIsolation: () => void;
  toggleCategory: (t: IfcType) => void;
  hideElement: (id: ExpressId) => void;
  showAll: () => void;
  setSection: (s: Partial<SectionState>) => void;
  flagUpdate: () => void;
  reload: () => void;
  requestFit: () => void;
  requestFocus: () => void;
  // internal lifecycle setters:
  _setStatus: (s: ViewportStatus, error?: string | null) => void;
  _setModel: (m: ParsedModel | null) => void;
}

export const initialViewportState = () => ({
  activeBuildingPropertyId: null,
  status: 'idle' as ViewportStatus,
  error: null,
  model: null,
  reloadNonce: 0,
  updateAvailable: false,
  fitNonce: 0,
  focusNonce: 0,
  selection: null,
  hiddenCategories: new Set<IfcType>(),
  isolated: null,
  hiddenElements: new Set<ExpressId>(),
  section: { enabled: false, axis: 'Y' as const, constant: 0 },
});

export const useViewportStore = create<ViewportState>()((set) => ({
  ...initialViewportState(),
  setActiveBuilding: (activeBuildingPropertyId) =>
    set({
      activeBuildingPropertyId,
      selection: null,
      isolated: null,
      hiddenCategories: new Set(),
      hiddenElements: new Set(),
      updateAvailable: false,
    }),
  select: (selection) => set({ selection }),
  isolate: (isolated) => set({ isolated }),
  clearIsolation: () => set({ isolated: null }),
  toggleCategory: (t) =>
    set((s) => {
      const n = new Set(s.hiddenCategories);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return { hiddenCategories: n };
    }),
  hideElement: (id) =>
    set((s) => {
      const n = new Set(s.hiddenElements);
      n.add(id);
      return { hiddenElements: n };
    }),
  showAll: () => set({ hiddenCategories: new Set(), hiddenElements: new Set(), isolated: null }),
  setSection: (p) => set((s) => ({ section: { ...s.section, ...p } })),
  flagUpdate: () => set({ updateAvailable: true }),
  reload: () => set((s) => ({ updateAvailable: false, reloadNonce: s.reloadNonce + 1 })),
  requestFit: () => set((s) => ({ fitNonce: s.fitNonce + 1 })),
  requestFocus: () => set((s) => ({ focusNonce: s.focusNonce + 1 })),
  _setStatus: (status, error = null) => set({ status, error }),
  _setModel: (model) => set({ model }),
}));
