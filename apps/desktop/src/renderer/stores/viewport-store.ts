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
  // Status overlay for `devices`, keyed by device id. Only ever holds ids that are in `devices`.
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
 * nodeStatus is an overlay on `devices`, not a cache of its own: every consumer reads it as
 * `nodeStatus.get(d.id) ?? 'unknown'` for a `d` in `devices`, so an entry for anything else is
 * unreadable by construction. It is fed by v1:device:status events, which fan out for every device
 * in the socket's SCOPE - not just the open building - once per probe cycle. Left unpruned it grows
 * an entry for every device the session has ever seen, in any building, plus dead entries for
 * deleted devices, for the life of the renderer.
 *
 * So keep it pinned to the loaded device set. Returns the SAME map when nothing needs dropping, so
 * a reload that changes nothing does not churn the reference and re-render every status subscriber.
 */
function pruneStatus(current: Map<string, NodeStatus>, devices: DeviceDto[]): Map<string, NodeStatus> {
  const next = new Map<string, NodeStatus>();
  for (const d of devices) {
    const st = current.get(d.id);
    if (st !== undefined) next.set(d.id, st);
  }
  // next only holds keys taken from current, so equal sizes means an identical key set.
  return next.size === current.size ? current : next;
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
      // Reset with the device set it overlays; the new building re-seeds it on load.
      nodeStatus: new Map(),
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
  setDevices: (devices) => set((s) => ({ devices, nodeStatus: pruneStatus(s.nodeStatus, devices) })),
  upsertDevice: (d) =>
    set((s) => ({
      devices: s.devices.some((x) => x.id === d.id)
        ? s.devices.map((x) => (x.id === d.id ? d : x))
        : [...s.devices, d],
    })),
  removeDevice: (id) =>
    set((s) => {
      let nodeStatus = s.nodeStatus;
      if (nodeStatus.has(id)) {
        // Clone only when there is something to drop: DEVICE_DELETED also fans out for devices
        // outside the open building, and a new map reference re-renders every status subscriber.
        nodeStatus = new Map(nodeStatus);
        nodeStatus.delete(id);
      }
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
      // Ignore devices that are not loaded: their status is unreadable (see pruneStatus) and
      // recording it is what let the map outgrow the device list. Statuses that arrive while the
      // list is still loading are not lost - loadStatusFor re-seeds once the devices land.
      if (!s.devices.some((d) => d.id === id)) return s;
      // Unchanged status: return the same state so the map is not cloned and no subscriber
      // re-renders. Most devices are steady, so this drops nearly every event of every cycle -
      // without it, N devices produce N full-map copies per probe cycle.
      if (s.nodeStatus.get(id) === st) return s;
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
