import { create } from 'zustand';
import type { AccessSummaryDto, OrgRole } from '@nodescope/shared';

interface AccessState {
  role: OrgRole | null;
  assignedRootPropertyIds: string[];
  unscoped: boolean;
  loaded: boolean;
  setAccess: (s: AccessSummaryDto) => void;
  reset: () => void;
}

export const useAccessStore = create<AccessState>((set) => ({
  role: null,
  assignedRootPropertyIds: [],
  unscoped: false,
  loaded: false,
  setAccess: (s) =>
    set({
      role: s.role,
      assignedRootPropertyIds: s.assignedRootPropertyIds,
      unscoped: s.unscoped,
      loaded: true,
    }),
  reset: () => set({ role: null, assignedRootPropertyIds: [], unscoped: false, loaded: false }),
}));

/** OWNER and ADMIN are org-admin roles; everything else is not. */
export function isOrgAdmin(role: OrgRole | null): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}
