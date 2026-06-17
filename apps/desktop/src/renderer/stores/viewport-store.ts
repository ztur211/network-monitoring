import { create } from 'zustand';
import type { DeviceDto, AccessSummaryDto } from '@nodescope/shared';
import type { ParsedModel, IfcType, ExpressId } from '../viewport/ifc/ifc-types';
import { type NodeFilter, emptyFilter } from '../viewport/nodes/filter-devices';
import type { NodeStatus } from '../viewport/nodes/node-status';

export type ViewportStatus = 'idle' | 'loading' | 'parsing' | 'ready' | 'empty' | 'error';
export interface SectionState {
  enabled: boolean;
  axis: 'X' | 'Y' | 'Z';
  constant: number;
}

// Unified tagged selection (Spec 4 §7): an IFC element (Spec 3) or a device node, or nothing.
export type Selection =
  | { kind: 'element'; expressID: ExpressId }
  | { kind: 'device'; deviceId: string }
  | null;

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
  selection: Selection;
  hiddenCategories: Set<IfcType>;
  isolated: ExpressId | null;
  hiddenElements: Set<ExpressId>;
  section: SectionState;
  // Spec 4 node state:
  devices: DeviceDto[];
  placingDeviceId: string | null;
  nodeFilter: NodeFilter;
  nodeStatus: Map<string, NodeStatus>;
  access: AccessSummaryDto | null;
  // Spec 3 actions:
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
  // Spec 4 selection + node actions:
  selectElement: (id: ExpressId) => void;
  selectNode: (deviceId: string) => void;
  clearSelection: () => void;
  setDevices: (d: DeviceDto[]) => void;
  upsertDevice: (d: DeviceDto) => void;
  removeDevice: (id: string) => void;
  beginPlace: (deviceId: string) => void;
  cancelPlace: () => void;
  setNodeFilter: (p: Partial<NodeFilter>) => void;
  setNodeStatus: (deviceId: string, s: NodeStatus) => void;
  setAccess: (a: AccessSummaryDto | null) => void;
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
  selection: null as Selection,
  hiddenCategories: new Set<IfcType>(),
  isolated: null as ExpressId | null,
  hiddenElements: new Set<ExpressId>(),
  section: { enabled: false, axis: 'Y' as const, constant: 0 },
  devices: [] as DeviceDto[],
  placingDeviceId: null as string | null,
  nodeFilter: emptyFilter(),
  nodeStatus: new Map<string, NodeStatus>(),
  access: null as AccessSummaryDto | null,
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
      // Spec 4: per-building node state resets (devices reload for the new building)
      devices: [],
      placingDeviceId: null,
    }),
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
  // Spec 4 selection + node actions:
  selectElement: (expressID) => set({ selection: { kind: 'element', expressID } }),
  selectNode: (deviceId) => set({ selection: { kind: 'device', deviceId } }),
  clearSelection: () => set({ selection: null }),
  setDevices: (devices) => set({ devices }),
  upsertDevice: (d) =>
    set((s) => ({
      devices: s.devices.some((x) => x.id === d.id)
        ? s.devices.map((x) => (x.id === d.id ? d : x))
        : [...s.devices, d],
    })),
  removeDevice: (id) =>
    set((s) => ({
      devices: s.devices.filter((x) => x.id !== id),
      selection: s.selection?.kind === 'device' && s.selection.deviceId === id ? null : s.selection,
    })),
  beginPlace: (placingDeviceId) => set({ placingDeviceId }),
  cancelPlace: () => set({ placingDeviceId: null }),
  setNodeFilter: (p) => set((s) => ({ nodeFilter: { ...s.nodeFilter, ...p } })),
  setNodeStatus: (id, st) =>
    set((s) => {
      const n = new Map(s.nodeStatus);
      n.set(id, st);
      return { nodeStatus: n };
    }),
  setAccess: (access) => set({ access }),
  _setStatus: (status, error = null) => set({ status, error }),
  _setModel: (model) => set({ model }),
}));
