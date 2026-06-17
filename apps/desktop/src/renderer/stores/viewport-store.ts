import { create } from 'zustand';

// The reserved Spec 3 boundary: Spec 3 adds camera/loaded-model/selection here and
// owns the Three.js render loop that reads/writes this store outside React's cycle.
interface ViewportState {
  activeBuildingPropertyId: string | null;
  setActiveBuilding: (id: string | null) => void;
}

export const useViewportStore = create<ViewportState>()((set) => ({
  activeBuildingPropertyId: null,
  setActiveBuilding: (activeBuildingPropertyId) => set({ activeBuildingPropertyId }),
}));
