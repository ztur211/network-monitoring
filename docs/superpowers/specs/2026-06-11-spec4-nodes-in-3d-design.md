# Spec 4 — Nodes in 3D (Device Placement, Node Panel & Selection)

- **Status:** Draft for review
- **Date:** 2026-06-11
- **Spec:** Spec 4 (3D/spatial track — fourth; the convergence point where the 3D track meets the permissions track)
- **Depends on:**
  - **Spec 3** *Public Interface* (§11) — the in-Canvas r3f scene (shared camera/controls/raycaster, demand loop), `ViewportCanvas`/`ModelView`, the extended `viewportStore`, and `ParsedModel` (`root`, `elementIndex`, `bbox`, **`frame { recenter, upConversion }`**). Spec 4 **refactors** Spec 3's `selection: expressID` into a tagged union (§7).
  - **Spec 1** *Public Interface* (§10) — `Device.x/y/z` (model-local meters, native frame), `PATCH /v1/devices/:id/position` (`DevicePositionDto` set/clear), `SPATIAL_001`/`SPATIAL_002`; `x/y/z` cleared when a device's building changes.
  - **F3** *Public Interface* (§10) — `PermissionsService` (`assertCanConfigure`, `inScope`, `scopeFilter`), `AccessSummaryDto` + `GET /v1/access/me`, scope-filtered device reads + scope-filtered `v1:device:updated`, `ORG_003`/`PERM_001`, `governingSiteId(device) = device.propertyId`.
  - **F2** *Public Interface* (§10) — `DeviceDto.propertyId`, `PropertiesService` `subtreePropertyIds`/`isAtOrUnder` (the building-subtree device query).
  - **Spec 2** *Public Interface* (§10) — `@nodescope/client` (extended here with a device-list + position method), the realtime client.
- **Downstream consumers:** the **Monitoring spec** (fills the §9 status-display seam with real device health + a realtime status event). Read only the *Public Interface* (§11).

---

## 1. Context

Spec 3 renders a building and lets you inspect its IFC elements; Spec 1 gave every `Device` optional model-local `x/y/z`; F3 scoped who may see and configure which devices. Spec 4 is the payoff and the **convergence of the two tracks**: it shows a building's network **devices as nodes in the 3D model**, lets authorized users **place / move / clear** them by clicking the building surface, and adds a **filterable Node panel** for at-a-glance review and selection.

It is a **frontend** spec — it adds no backend model. It positions **existing** devices (created via the existing device API) and persists through Spec 1's position endpoint, gated by F3. Live device **health monitoring** is explicitly a *separate* subsystem: Spec 4 ships a **status-display seam** (§9) that a future **Monitoring spec** fills; in v1 every node's status is `unknown`.

## 2. Goals

1. Render each *placed* device of the active building as a **category-coded marker** in Spec 3's existing r3f scene, positioned via `ParsedModel.frame`.
2. **Select-then-click placement** — pick an unplaced device, click the building surface to set `x/y/z`; **Move** / **Clear** a placed node.
3. A **Node panel** (right dock): a filterable list of the building's in-scope devices, selection-synced with the scene, doubling as the placement source.
4. **Unified tagged selection** — one selection that is either an IFC element (Spec 3) or a device, with one switching Inspector.
5. **F3-correct affordances** — placement controls appear only where the user may configure that device; the server enforces regardless.
6. A **status-display seam** (§9) and a clean **Public Interface** (§11) for the Monitoring spec.

## 3. Non-Goals (explicitly out of scope for Spec 4)

- **Device health / live monitoring** (up/down, metrics, a data source/pipeline) → the separate **Monitoring spec**. Spec 4 only defines the display seam.
- **Creating / deleting device records, or editing non-spatial fields** → the existing device API; Spec 4 positions existing devices.
- **The 2D `latitude/longitude/floor`** map data → untouched and independent of 3D placement.
- **Drag-and-drop placement / drag-to-move** — select-then-click only in v1 (drag-in-3D disambiguation deferred).
- **Free-space (mid-air) placement** — a placement must hit building geometry.
- **Multi-select / bulk placement**, **`InstancedMesh` markers** (perf, deferred), **per-device assignment** (F3 §14).
- **Building rendering / navigation / IFC inspect-isolate-section** — Spec 3, unchanged (Spec 4 layers on top).

## 4. Architecture

Spec 4 adds a **node layer** into Spec 3's `<ViewportCanvas>` (one scene; shared camera, controls, raycaster, demand loop) and a DOM **Node panel** in the right dock, and extends `viewportStore`.

```
apps/desktop/src/renderer/viewport/nodes/
  node-coords.ts        (pure: toViewport / toModel from ParsedModel.frame)
  node-status.ts        (NodeStatus type + status→colour; the seam)
  filter-devices.ts     (pure: filterDevices(devices, filter))
  can-configure.ts      (pure: canConfigure(access) — role gate)
  NodeLayer.tsx         (in-Canvas: a marker per placed device)
  PlacementController.tsx (in-Canvas: surface raycast → toModel → PATCH)
  picking-nodes.ts      (pure pickNode + marker raycast priority)
  use-device-load.ts    (load the building's devices; realtime sync)
  ui/NodePanel.tsx      (right-dock list + filters)
  ui/DeviceDetails.tsx  (device branch of the Inspector)
```
Modified: `stores/viewport-store.ts` (node state + tagged selection), `viewport/scene/ViewportCanvas.tsx` (mount `<NodeLayer>` + `<PlacementController>`), `viewport/interaction/picking.ts` + `scene/apply-model-state.ts` + `ui/Inspector.tsx` (the tagged-selection refactor), `shell/ViewportHost.tsx` (mount the Node panel), `data/clients.ts`/`@nodescope/client` (device methods).

## 5. Coordinate bridge & node layer

- **`node-coords.ts`** builds one matrix from Spec 3's `frame`: `M = Rx(−90°) · T(−recenter)` (the same transform Spec 3 applies to `root`). `toViewport(xyz) = M · xyz` positions a marker; `toModel(point) = M⁻¹ · point` turns a world-space raycast hit into native `x/y/z`. Pure and round-trip-tested (`toModel(toViewport(p)) ≈ p`).
- **`NodeLayer`** (inside the Canvas) renders one **billboard sprite** per *placed* device (those with non-null `x/y/z`) at `toViewport`, **coloured by device category**, with a **status ring** (§9); the selected node is emphasised (scale/outline). Sprites face the camera (readable at any zoom, no occlusion surprises); names live in the Inspector, not the scene. Markers are added at world positions (not parented under `model.root`), so they are independent of building visibility/section toggles.
- Marker representation is billboard sprites in v1; `InstancedMesh` is the deferred perf path (device counts per building are modest).

## 6. Placement / move / clear

- **Place:** select an *unplaced* device (panel or list) → **Place** enters *placing mode* (`placingDeviceId` set) → pointer-down raycasts the building meshes (`ParsedModel.elementIndex`, visible only) → on a hit, `toModel(hit)` → `setDevicePosition(id, {x,y,z})`. **No hit ⇒ no-op** (mid-air placement is rejected). **Esc / a second click elsewhere cancels.**
- **Move:** select a placed marker → **Move** re-enters placing mode for that device → next surface click repositions it.
- **Clear:** **Clear position** → `setDevicePosition(id, null)` → the device returns to *unplaced* (marker removed).
- **Optimistic** store update on every set/clear; on a rejected `PATCH` (F3 `ORG_003`/`PERM_001`, or Spec 1 `SPATIAL_001`/`SPATIAL_002`) the prior position is **rolled back** and a toast surfaces the reason.

## 7. Node panel, unified selection & Inspector

- **Unified selection (refactors Spec 3).** `viewportStore.selection` becomes `{ kind:'element', expressID } | { kind:'device', deviceId } | null`. **Markers raycast with priority over the building** — a pointer-down hits a marker → device selection; else the building → element selection (Spec 3 `pickExpressId`); empty space clears. Spec 3's `apply-model-state` highlight, `picking`, and `Inspector` are updated to read the tagged shape.
- **Node panel** (right dock, always visible — the monitoring surface): a row per in-scope device of the building — name · category colour-chip · placed/unplaced · status badge. A pure **`filterDevices(devices, filter)`** drives filters: **text** (name/ip/mac) · **category** · **network** · **placement** (all/placed/unplaced) · **floor** · **status**. Selecting a row sets the unified selection (and emphasises the marker); the placement flow starts here (filter *unplaced* → select → **Place**).
- **Inspector / Details area** (below the list) switches on `selection.kind`: a **device** shows name, category, network, site path, ip/mac, status, position (`x/y/z` or "Unplaced") + actions **Place/Move/Clear/Zoom-to**; an **element** shows Spec 3's IFC type/name/property-sets + isolate/hide/zoom (unchanged content). **Zoom-to** a node reuses Spec 3's `ViewCommands` to frame the marker.

## 8. Permissions (F3)

- The client loads `AccessSummaryDto` (`GET /v1/access/me`) once on bootstrap into the store (`access`).
- **Reads are already server-side scope-filtered** (F3) — `listDevicesForBuilding` returns only in-scope devices, so the panel and scene never show out-of-scope nodes.
- **Configure affordances** (Place / Move / Clear / placing mode) render **only** for roles that may configure — a pure **`canConfigure(access)`** = `access.role === 'OWNER' || access.role === 'ADMIN'`; **MEMBER is view-only.** No client-side subtree check is needed: the device list is already F3 **read**-scope-filtered, and an ADMIN's read-scope *equals* their configure-scope (F3 §5), so every *listed* device is configurable by an OWNER/ADMIN.
- **The server is the authority** — `PATCH position` runs F3's `assertCanConfigure(user, device)` (`governingSiteId = device.propertyId`): MEMBER → `ORG_003`, out-of-scope ADMIN → `PERM_001`. The client gate is UX only; a rejected write rolls back (§6).

## 9. Status-display seam (the Monitoring boundary)

- Spec 4 owns the **display** type only: `NodeStatus = 'up' | 'down' | 'warning' | 'unknown'` (`node-status.ts`), with a fixed colour map (green/red/amber/grey) used by the marker ring and the panel badge, and a **status filter**.
- Source: `viewportStore.nodeStatus: Map<deviceId, NodeStatus>` + a `setNodeStatus(deviceId, status)` action. **In v1 the map is empty ⇒ every node renders `unknown`.**
- The **Monitoring spec** will populate this map (initial fetch + its own realtime status event) — Spec 4's markers and panel light up live **with no redesign**. Spec 4 ships only the consumer + the `unknown` default.

## 10. Data & realtime

- **Load:** `@nodescope/client.listDevicesForBuilding(buildingPropertyId)` → `GET /v1/devices?buildingPropertyId=…` (F3 scope-filtered; devices whose `propertyId ∈ subtreePropertyIds(building)`). Loaded into `store.devices` keyed on the active building (alongside Spec 3's model load); stale loads discarded (Spec 3's race pattern).
- **Persist:** `@nodescope/client.setDevicePosition(id, pos | null)` → Spec 1's `PATCH /v1/devices/:id/position`.
- **Sync:** subscribe to `v1:device:updated` (F3-scoped; carries `x/y/z`) → patch the store device → marker + list reflect live; `v1:device:created`/`:deleted` add/remove rows (device CRUD stays the existing API; Spec 4 only reacts). A device whose building changes drops from the list (its `x/y/z` is cleared by Spec 1).

## 11. Public Interface (the contract the Monitoring spec builds on)

- **Status seam:** the `NodeStatus` type, `viewportStore.nodeStatus` + `setNodeStatus(deviceId, status)`, and the marker-ring/panel-badge/status-filter consumers. The Monitoring spec drives `setNodeStatus` from its fetch + realtime status event; it must not need any other Spec 4 internals.
- **Coordinate bridge:** `node-coords` `toViewport(xyz)` / `toModel(point)` (built from `ParsedModel.frame`) — for any future 3D node feature.
- **Unified selection:** `viewportStore.selection` tagged union (`element` | `device`) + `selectNode(deviceId)` / `selectElement(expressID)`.
- **Client:** `listDevicesForBuilding(propertyId)`, `setDevicePosition(id, pos|null)`.

## 12. Security Considerations

- **Server-enforced scope:** placement and the device list go through F3's repository chokepoint — the client's `canConfigureDevice` only hides affordances; the `PATCH` is authorised server-side, and out-of-scope devices are never returned by `listDevicesForBuilding`.
- **No client-trusted coordinates beyond the device's own building:** `x/y/z` are interpreted in the device's building model (Spec 1); the panel only lists this building's devices, so a placement always targets the correct model. A foreign `deviceId` is validated against scope server-side (`ORG_008`/`PERM_001`).
- **Optimistic-update integrity:** a rejected `PATCH` always rolls the marker back to the server-confirmed position; realtime `v1:device:updated` is the source of truth across clients.
- No new IPC, no Node access — the node layer runs in the same sandboxed renderer as Spec 3.

## 13. Testing (TDD — test first)

- **`node-coords`** (node): `toModel(toViewport(p)) ≈ p`; a known `frame` maps Z-up native → Y-up viewport as expected.
- **`filterDevices`** (pure): each dimension (text/category/network/placement/floor/status) and combinations.
- **`canConfigure`** (pure): OWNER → true; ADMIN → true; MEMBER → false. (The list is already F3 scope-filtered, so a *listed* device is configurable by any OWNER/ADMIN.)
- **Store** (node state): tagged `selectNode`/`selectElement`; `beginPlace`/`commitPlace`/`cancelPlace`; `moveNode`/`clearNodePosition` optimistic + rollback on rejection; `setNodeFilter`; `setNodeStatus`.
- **`pickNode`** (node, mocked raycaster): a marker is picked in preference to the building behind it; returns the `deviceId`; placed-only.
- **`PlacementController`** (node): a building hit → `toModel` → `setDevicePosition` with native `x/y/z`; no hit → no call; cancel clears `placingDeviceId`.
- **`NodePanel` / `DeviceDetails`** (RTL + mocked store): filtered list renders; row click sets the unified selection; **Place/Move/Clear shown only when `canConfigureDevice`**; element vs device details switch on `selection.kind`; status badge renders.
- **`NodeLayer`** render-smoke (`@react-three/test-renderer`): a marker mounts per placed device at the mapped position; the selected one is emphasised; unplaced devices render no marker.
- **Realtime** (mocked client): `v1:device:updated` for a listed device updates its position/attributes live.
- *Deep GPU/visual correctness (marker legibility, sprite scaling) is verified manually — per Spec 3 §13.*

## 14. Documentation (Rule 10 — same-commit doc updates)

- `apps/desktop/README.md`: the node layer + Node panel, select-then-click placement, the `node-coords` bridge, and that **status is a seam the Monitoring spec fills** (v1 = `unknown`).
- Update the SAD/CLAUDE.md: the desktop viewport now shows network nodes in 3D against the building; the unified (element|device) selection; F3-gated placement; the device-list-for-building client/endpoint.
- Register the `?buildingPropertyId` device-list filter (and confirm the `PATCH /v1/devices/:id/position` usage) in the API Design Document.

## 15. Open Questions (non-blocking; resolve during writing-plans / implementation)

- **Device-list-for-building endpoint shape:** a `?buildingPropertyId=` query param on the existing `GET /v1/devices` vs a dedicated route — confirm against the device controller in Phase A. (Either way it is F3 scope-filtered and subtree-resolved via `PropertiesService`.)
- **Status realtime event** name/shape is owned by the **Monitoring spec**; Spec 4 defines only the `setNodeStatus` consumer.
- **Floor filter source:** `device.floor` (default) vs deriving storeys from the IFC spatial structure.
- **"Zoom-to" framing:** just the marker, or the marker plus surrounding context.
- **Marker scaling / clustering** at extreme zoom or high device density; `InstancedMesh` if counts grow.
- **Selection priority detail:** a click that hits both a marker and the building always takes the marker — confirm the pixel-radius/pick tolerance during implementation.
- **Nodes vs. building toggles:** v1 keeps markers visible regardless of Spec 3's section/isolate/category-hide (§5) — confirm whether a section cut should also hide nodes beyond the cut, or always show them as a separate layer.
