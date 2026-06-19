import { create } from 'zustand';
import type { OrganizationDto } from '@nodescope/shared';

interface AuthState {
  authed: boolean;
  org: OrganizationDto | null;
  setAuthed: (v: boolean) => void;
  setOrg: (o: OrganizationDto | null) => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  authed: false,
  org: null,
  setAuthed: (authed) => set({ authed }),
  setOrg: (org) => set({ org }),
}));
