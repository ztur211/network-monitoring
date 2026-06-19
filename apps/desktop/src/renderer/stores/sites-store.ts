import { create } from 'zustand';
import type { PropertyDto } from '@nodescope/shared';

interface SitesState {
  properties: PropertyDto[];
  selectedBuildingId: string | null;
  setProperties: (p: PropertyDto[]) => void;
  selectBuilding: (id: string | null) => void;
}

export const useSitesStore = create<SitesState>()((set) => ({
  properties: [],
  selectedBuildingId: null,
  setProperties: (properties) => set({ properties }),
  selectBuilding: (selectedBuildingId) => set({ selectedBuildingId }),
}));
