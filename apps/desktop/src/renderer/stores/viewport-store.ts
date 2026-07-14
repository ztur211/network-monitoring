import { create } from 'zustand';
import * as THREE from 'three';
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
  // The device currently in "link to BIM object" mode (next element click sets its ifcGlobalId).
  // Mutually exclusive with placingDeviceId.
  linkingDeviceId: string | null;
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
  beginLink: (deviceId: string) => void;
  cancelLink: () => void;
  setNodeFilter: (p: Partial<NodeFilter>) => void;
  setNodeStatus: (deviceId: string, s: NodeStatus) => void;
  setAccess: (a: AccessSummaryDto | null) => void;
  // Spec 6 Phase E: BCF viewpoint camera request (set by navigateToViewpoint, consumed by ViewCommands)
  viewpointRequest: { camera: { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; fov: number }; nonce: number } | null;
  setViewpointRequest: (req: { camera: { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; fov: number }; nonce: number }) => void;
  setHiddenElements: (s: Set<ExpressId>) => void;
  // Spec 6 Phase E: live camera snapshot (updated per-frame by ViewCommands for create-from-view)
  cameraSnapshot: { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; fov: number } | null;
  setCameraSnapshot: (snap: { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; fov: number }) => void;
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
  linkingDeviceId: null as string | null,
  nodeFilter: emptyFilter(),
  nodeStatus: new Map<string, NodeStatus>(),
  access: null as AccessSummaryDto | null,
  viewpointRequest: null as { camera: { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; fov: number }; nonce: number } | null,
  cameraSnapshot: null as { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; fov: number } | null,
});

/**
 * Keep only the statuses of devices that are actually loaded. Returns the SAME map when
 * nothing needs dropping, so a device reload that changes nothing does not churn the
 * reference and re-render every status subscriber.
 */
function retainStatuses(current: Map<string, NodeStatus>, devices: DeviceDto[]): Map<string, NodeStatus> {
  const live = new Set(devices.map((d) => d.id));
  let stale = false;
  for (const id of current.keys()) {
    if (!live.has(id)) {
      stale = true;
      break;
    }
  }
  if (!stale) return current;
  return new Map([...current].filter(([id]) => live.has(id)));
}

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
      linkingDeviceId: null,
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
  // nodeStatus is an overlay of realtime v1:device:status events, which fan out for every
  // device in the socket's SCOPE - not just the open building - once per probe cycle. Nothing
  // used to remove from it, so a long-lived session (a NOC wall display) accumulated an entry
  // for every device it had ever seen in any building, plus entries for deleted devices. Since
  // setNodeStatus clones the whole map on every event, that unbounded map also made each event
  // progressively more expensive. Prune it to the devices actually loaded.
  setDevices: (devices) =>
    set((s) => ({
      devices,
      nodeStatus: retainStatuses(s.nodeStatus, devices),
    })),
  upsertDevice: (d) =>
    set((s) => ({
      devices: s.devices.some((x) => x.id === d.id)
        ? s.devices.map((x) => (x.id === d.id ? d : x))
        : [...s.devices, d],
    })),
  removeDevice: (id) =>
    set((s) => {
      const nodeStatus = new Map(s.nodeStatus);
      nodeStatus.delete(id);
      return {
        devices: s.devices.filter((x) => x.id !== id),
        nodeStatus,
        selection: s.selection?.kind === 'device' && s.selection.deviceId === id ? null : s.selection,
      };
    }),
  beginPlace: (placingDeviceId) => set({ placingDeviceId, linkingDeviceId: null }),
  cancelPlace: () => set({ placingDeviceId: null }),
  beginLink: (linkingDeviceId) => set({ linkingDeviceId, placingDeviceId: null }),
  cancelLink: () => set({ linkingDeviceId: null }),
  setNodeFilter: (p) => set((s) => ({ nodeFilter: { ...s.nodeFilter, ...p } })),
  setNodeStatus: (id, st) =>
    set((s) => {
      const n = new Map(s.nodeStatus);
      n.set(id, st);
      return { nodeStatus: n };
    }),
  setAccess: (access) => set({ access }),
  setViewpointRequest: (viewpointRequest) => set({ viewpointRequest }),
  setHiddenElements: (hiddenElements) => set({ hiddenElements }),
  setCameraSnapshot: (cameraSnapshot) => set({ cameraSnapshot }),
  _setStatus: (status, error = null) => set({ status, error }),
  _setModel: (model) => set({ model }),
}));
