# Spec 3 — 3D Viewport (web-ifc + react-three-fiber)

- **Status:** Draft for review
- **Date:** 2026-06-11
- **Spec:** Spec 3 (3D/spatial track — third; Spec 1 → 2 → **3** → 4, converges with the permissions track at Spec 4)
- **Depends on:**
  - **Spec 2** *Public Interface* (§10) — the `<ViewportHost>` mount point in the Electron renderer, the reserved `viewportStore` (Zustand) React↔render-loop seam, `@nodescope/client` (`getBuildingModel(propertyId)`, `getActiveModelFile(propertyId)`, `listProperties()`, the realtime client, `getToken()`), the sandboxed renderer (`contextIsolation`, no Node), and the preload bridge.
  - **Spec 1** *Public Interface* (§10) — `GET /v1/buildings/:propertyId/model` (metadata; `MODEL_001` = no model) and `GET …/model/active/file` (proxied IFC stream); `BuildingModelDto` / `BuildingModelVersionDto`; the `v1:buildingModel:versionUploaded` / `activated` / `deleted` events on `org:{organizationId}`; the model-local coordinate frame (meters, native — IFC is typically Z-up — origin stable across versions).
  - Inherited transitively via Spec 2's client: **F1a** realtime org room + the `{ success, data, timestamp }` envelope.
- **Downstream consumers:** **Spec 4** (nodes in 3D — places & picks `Device` `x/y/z` against this viewport's model and coordinate frame; needs F3). Read only the *Public Interface* (§11).

---

## 1. Context

NodeScope's pivot puts network nodes in 3D against a shared building model. Spec 1 made the server **store and serve** per-building versioned IFC models (it does **not** parse them); Spec 2 shipped the Electron desktop shell with a **placeholder** `<ViewportHost>` and a reserved `viewportStore`. Spec 3 fills that placeholder: it **downloads the active IFC for the selected building and renders it as a navigable, inspectable 3D model**, entirely client-side.

It renders the **building only** — placing and picking device nodes in 3D is Spec 4 (which needs F3). Spec 3 is the stage; Spec 4 puts the actors on it. web-ifc (Rust→WASM, consumed via npm — no Rust authored) parses the IFC in the renderer; react-three-fiber (r3f) owns the WebGL canvas and a demand-driven render loop; the geometry lives in plain Three.js objects bridged to React through `viewportStore`, exactly as Spec 2's seam intended.

## 2. Goals

1. Render the active `BuildingModel` for the selected `BUILDING` in an r3f `<Canvas>` mounted at Spec 2's `<ViewportHost>`.
2. **Navigate** — orbit / pan / zoom, zoom-to-fit, zoom-to-selection.
3. **Inspect** — click an element → highlight + a docked inspector showing its IFC type, name/tag, and property sets.
4. **Control visibility** — isolate / hide the selection, hide whole IFC categories, and a single movable section (clip) plane.
5. Robust **loading / empty / error** states; never crash the renderer on a bad model.
6. A clean **Public Interface** (§11) so Spec 4 places nodes in the same coordinate space.

## 3. Non-Goals (explicitly out of scope for Spec 3)

- **Device-node rendering / placement / picking** → Spec 4 (needs F3).
- **Authoring or editing the building model** — upload/version management is Spec 1's API; Spec 3 is a **read-only** viewer.
- **Performance engineering** — web-ifc parses on the **main thread** and geometry is **mesh-per-element**; large models visibly hitch while parsing. Off-main-thread parsing + geometry batching/instancing are a deliberate **later pass** (§10), kept behind the `IfcModelLoader` interface.
- **Walk / first-person navigation** — orbit only in v1.
- **Multi-plane sectioning, measurement, markup, BCF** — a single section plane in v1; the rest later / Spec 6.
- **Viewing non-active versions** — active version only; Spec 1 can serve others, a picker is deferred.
- **Disk / offline caching** of models — in-memory session cache only (Spec 2 §14 owns offline).
- **macOS / Linux specifics** — inherits Spec 2's Windows-first packaging unchanged.

## 4. Architecture

The viewport replaces Spec 2's `<ViewportHost>` internals with an r3f `<Canvas frameloop="demand">`. The boundary:

- **React (DOM)** renders the UI shell and overlays (toolbar, inspector, state overlays).
- **Plain Three.js** holds the model geometry (a `THREE.Group` tree); it is *not* reconciled by React.
- **r3f** owns the `<Canvas>`, camera, controls, and a **demand** render loop (`invalidate()` on camera/state change) — a building is near-static, so continuous rAF is wasteful on a laptop GPU.
- **`viewportStore` (Zustand)** is the bridge: imperative code (web-ifc results, raycasting, the loop) reads/writes it without forcing React re-renders; the DOM overlays subscribe to the slices they show. It **extends** Spec 2's reserved store (`activeBuildingPropertyId`, `camera`, `selection`).

```
apps/desktop/src/renderer/viewport/
  ifc/         ifcModelLoader.ts  (web-ifc wrapper → ParsedModel)   ifcTypes.ts
  scene/       ViewportCanvas.tsx  ModelView.tsx  CameraRig.tsx  lighting.tsx
  interaction/ picking.ts  section.ts  visibility.ts
  ui/          Toolbar.tsx  Inspector.tsx  overlays/ (Idle, Loading, Empty, Error, UpdateBanner)
  store/       viewportStore.ts   (extends Spec 2's reserved store)
  ViewportHost.tsx                (Spec 2's placeholder, now the real mount)
```

## 5. IFC parsing — `IfcModelLoader` (`ifc/`)

The single wrapper over web-ifc's `IfcAPI`; the only code that touches the WASM.

- **WASM:** web-ifc's `.wasm` is bundled as a renderer asset (electron-vite `publicDir` / `assetsInclude`); `IfcAPI.SetWasmPath` points at it. Initialized once, lazily, on first load.
- **`loadModel(bytes: ArrayBuffer): Promise<ParsedModel>`** (main thread):
  1. `OpenModel(new Uint8Array(bytes))` → `modelID`.
  2. `LoadAllGeometry(modelID)` → iterate `FlatMesh`es. For each element (`expressID`): merge its `PlacedGeometry` parts (apply each part's matrix + color) into one `BufferGeometry`; create a `Mesh` with `userData = { expressID, ifcType }`; parent it under a per-category `THREE.Group` keyed by IFC class (`IfcWall`, `IfcSlab`, `IfcFurnishingElement`, …).
  3. Compute the model bbox; apply a **recenter** translation (−center) and a **Z-up→Y-up** basis rotation to `root`, so large IFC world coordinates keep float precision and the model sits in Three.js's Y-up frame.
  4. Keep the model **open** for lazy property queries.
- **`getProperties(expressID)`** — `GetItemProperties` + `GetPropertySets` (+ type / name / tag), shaped into an `ElementProperties` DTO; called on demand by the inspector.
- **`dispose()`** — `CloseModel`, dispose geometries/materials, drop references.
- Returns:

```
ParsedModel {
  root: THREE.Group                       // recentered, Y-up
  categories: Map<ifcType, THREE.Group>
  elementIndex: Map<expressID, THREE.Mesh>
  bbox: THREE.Box3                        // in recentered space
  frame: { recenter: Vector3, upConversion: 'Z_UP_TO_Y_UP' }   // for Spec 4
  getProperties(expressID): Promise<ElementProperties>
  dispose(): void
}
```

> **Why mesh-per-element.** Inspect + isolate + category-hide all need per-element addressability (raycast → `expressID`; toggle a single element or category). Mesh-per-element makes that trivial, at the cost of draw calls; merging per category with an id-buffer for GPU picking is the §10 perf pass, behind this same interface.

## 6. Scene & rendering (`scene/`)

- **`<ViewportCanvas>`** — the r3f `<Canvas frameloop="demand">`: sets `gl.localClippingEnabled = true` (for §8 sectioning), a hemisphere + directional light rig, a neutral background + ground grid, and `<OrbitControls>` (orbit/pan/zoom; `onChange → invalidate()`).
- **`<ModelView model>`** — `<primitive object={model.root} />`; subscribes to `viewportStore` and applies per-mesh **visibility** (§8), the **highlight** material on `selection`, and the active **clip plane** to materials.
- **`<CameraRig>`** — frames `model.bbox` on load (fit), and **zoom-to-selection** (frames the selected mesh's bbox); owns camera + orbit-target placement.

## 7. Interaction — picking & inspect (`interaction/picking.ts`, `ui/Inspector.tsx`)

- **Pick:** pointer-down → raycast the **visible** meshes under `model.root` → nearest hit's `userData.expressID` → `store.select(expressID)`. Clicking empty space clears the selection.
- **Highlight:** `<ModelView>` renders the selected mesh with a highlight material (emissive overlay by default — see §15), demand-invalidated.
- **Inspector** (docked right, collapsible): on `selection`, calls `model.getProperties(expressID)` and shows the IFC **type**, **name / tag**, and **property sets** (grouped). Actions: **isolate**, **hide**, **zoom-to**.

## 8. Visibility & sectioning (`interaction/visibility.ts`, `interaction/section.ts`)

- **State** (in `viewportStore`): `hiddenCategories: Set<ifcType>`, `isolated: expressID | null`, `hiddenElements: Set<expressID>`, `section: { enabled, axis, constant }`.
- **Derivation** — a pure `isMeshVisible(mesh, state)`: visible iff `ifcType ∉ hiddenCategories` **and** `expressID ∉ hiddenElements` **and** (`isolated == null` **or** `expressID == isolated`). `<ModelView>` applies it to `mesh.visible`. Pure → testable without WebGL.
- **Category menu** (toolbar): lists the model's IFC categories with element counts + visibility toggles; **show all** clears `hiddenCategories` / `hiddenElements` / `isolated`.
- **Section plane:** a single `THREE.Plane` with presets — **floor-cut** (horizontal / Y), **vert-X**, **vert-Y** — plus an enable toggle and a position slider spanning the model's bbox extent on that axis. Applied as `material.clippingPlanes` while enabled.

## 9. Load lifecycle, states & realtime

**Lifecycle** (a renderer effect keyed on `store.activeBuildingPropertyId`):
1. `status='loading'` → `client.getBuildingModel(propertyId)`. `MODEL_001` → `status='empty'`.
2. Download `client.getActiveModelFile(propertyId)` → `ArrayBuffer` (content-length → progress).
3. `status='parsing'` → `IfcModelLoader.loadModel(bytes)`.
4. Success → store `model`, `status='ready'`; `<ModelView>` mounts; `<CameraRig>` fits; `invalidate()`.
5. **Race-safety:** each load carries its target `(propertyId, activeVersionId)`; a resolving load whose target ≠ the current selection is discarded (and its model disposed).
6. **Switch:** the outgoing model moves into a **keep-last-1** in-memory session cache (toggling straight back is then instant); whatever that cache evicts is disposed (free buffers + `CloseModel`). A model is freed on cache eviction, not on every switch.

**States:** *idle* ("Select a building to view its model") · *loading / parsing* (progress bar + spinner; cancels on switch) · *empty* (`MODEL_001` — "No 3D model has been uploaded for this building yet"; OWNER/ADMIN upload via Spec 1's API) · *error* — download / `401` (→ Spec 2 re-auth), **parse failure** ("Couldn't open this model" + retry; caught, never crashes the renderer), **WASM-init failure** (surfaced once; blocks the viewport with a clear message).

**Realtime:** subscribed (via Spec 2) to `org:{organizationId}`; for the **open** building → `v1:buildingModel:activated` / `versionUploaded` raises a non-intrusive **"Model updated — reload"** banner (no auto-reload mid-inspection); `v1:buildingModel:deleted` reverts to *empty*.

## 10. Performance posture (deferred, by design)

v1 favors the **thinnest correct pipeline**. The planned later passes each sit behind an existing seam so they don't ripple:

- **Worker offload:** move `IfcModelLoader.loadModel` into a Web Worker (transfer geometry buffers), removing the parse-time main-thread stall — the interface is unchanged.
- **Geometry batching:** merge per-category into batched `BufferGeometry` with an `expressID` vertex attribute + GPU id-buffer picking, cutting draw calls; `isMeshVisible` becomes a draw-range/attribute toggle. Picking, visibility, and Spec 4 are all written against `expressID` (not mesh identity), so they're unaffected.
- **Disk cache** of downloaded IFC / parsed geometry (Spec 2 §14 offline-caching).

## 11. Public Interface (the contract Spec 4 builds on)

Spec 4 reads **only this section**.

- **`viewportStore`** (extended): `{ status, error?, model?, selection, hiddenCategories, isolated, hiddenElements, section }` + actions `select / isolate / clearIsolation / toggleCategory / hideElement / showAll / setSection`. Spec 4 adds node placement/selection state onto this same store.
- **`ParsedModel`** handle: `root`, `categories`, `elementIndex`, `bbox`, **`frame { recenter, upConversion }`**, `getProperties`, `dispose`. Spec 4 places nodes in `root`'s **recentered, Y-up** space and raycasts `elementIndex` meshes for snapping/placement.
- **Coordinate mapping:** `viewportPoint = Y_up( worldPoint − recenter )`. Spec 1 stores device `x/y/z` as **model-local meters in the native frame**; Spec 4 converts stored ↔ viewport via this documented transform (its inverse for persistence).
- **`<ViewportHost>`** is now the live viewport — Spec 2's placeholder contract is satisfied, not changed.

## 12. Security Considerations

- The renderer stays **sandboxed** (Spec 2: `contextIsolation`, no `nodeIntegration`); the viewport adds no Node access and no new IPC — it only calls `@nodescope/client` (bearer token via the preload bridge) and runs WASM inside the renderer sandbox.
- IFC bytes are **untrusted input**: web-ifc parses them in-sandbox; a malformed model is caught and surfaced as a parse error (Spec 1 already enforces a size cap + shallow validation server-side). No `eval`, no code derived from model content.
- The WASM asset is **bundled with the app** (not fetched at runtime) — no remote-code path.
- Model bytes are fetched only from the configured API origin over the authenticated client; `401` routes to Spec 2's re-auth.

## 13. Testing (TDD — test first)

- **`IfcModelLoader`** (Vitest, node + a tiny fixture `.ifc`): element count, category grouping, `elementIndex`, bbox, recenter + Z-up→Y-up applied, `getProperties` returns property sets, `dispose` → `CloseModel`. (web-ifc runs under node.)
- **Store + visibility** (Vitest, pure): selection / isolate / clear / category / hidden / section reducers; the `isMeshVisible(mesh, state)` truth table.
- **Picking** (Vitest, mocked raycaster): nearest `expressID` selected; hidden meshes skipped; empty space clears.
- **Components** (RTL + mocked store): inspector renders type/name/psets and dispatches isolate/hide/zoom; toolbar category toggles + show-all; overlays render per `status`; the "model updated" banner appears on the realtime event and reload re-triggers the lifecycle.
- **Render smoke** (r3f + mocked WebGL): `<ViewportCanvas>` mounts with a fake `ParsedModel` without throwing.
- *Deep GPU / visual correctness (actual pixels, clip-plane geometry) is verified manually — out of automated scope.*

## 14. Documentation (Rule 10 — same-commit doc updates)

- `apps/desktop/README.md`: the viewport module map, the web-ifc WASM asset/bundling note, and that IFC parsing is **client-side, main-thread (v1)**.
- Update the SAD / CLAUDE.md: the desktop app now renders 3D (r3f + web-ifc); note the `viewportStore` / `ParsedModel` seam and the recenter + Y-up coordinate convention that Spec 4 depends on.
- No API / error-code / event changes — Spec 3 is a pure client of Spec 1 / Spec 2's interfaces.

## 15. Open Questions (non-blocking; resolve during writing-plans / implementation)

- **Web-ifc API surface:** confirm the exact `IfcAPI` calls/version and the `FlatMesh` → `BufferGeometry` path (color/material handling, double-sided faces) against the pinned web-ifc release during Phase A.
- **Highlight technique:** emissive material swap vs an outline pass — pick the cheapest that reads well on demand frames.
- **Category taxonomy:** group strictly by IFC class, or also offer **by-storey** grouping in the visibility menu (storey needs spatial-structure traversal). v1 = by IFC class; by-storey is a candidate add.
- **Property-set depth:** all psets vs a curated subset; default all, revisit if noisy.
- **Cancellation:** abort an in-flight download on building switch (`AbortController`) vs just discard the result (race-safety already covers correctness); abort is a bandwidth nicety.
