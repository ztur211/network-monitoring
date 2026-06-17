# @nodescope/desktop

The NodeScope desktop client (Electron + React-DOM). It hosts the 3D viewport (Spec 3) and
node-placement UI (Spec 4); today it ships the **shell**: system-browser auth, the API + realtime
connection, the org/site sidebar, and a `<ViewportHost>` placeholder.

Built with **electron-vite** (`main` / `preload` / `renderer`), `contextIsolation` + `sandbox`,
no `nodeIntegration`. The renderer talks to the API only through `@nodescope/client`, fed a bearer
token via the preload bridge (`window.nodescope`).

## Develop

```bash
# from the repo root (build @nodescope/shared + @nodescope/client first via postinstall)
npm install
npm run dev:desktop          # electron-vite dev (HMR) — point it at a running API
```

The API base URL comes from `VITE_API_URL` (default `http://localhost:3000/api`), overridable at
runtime in **Settings** (persisted to `userData/settings.json`; **restart to apply**).

## Auth (system-browser PKCE)

`window.nodescope.auth.login()` opens the system browser to `/v1/desktop-auth/authorize` with a
PKCE `code_challenge` + `state`, and the OS hands the `nodescope://auth/callback?code&state` redirect
back to the app (single-instance lock; `second-instance` argv on Windows/Linux, `open-url` on macOS).
The main process exchanges the code at `/v1/desktop-auth/token` and stores the token via OS-encrypted
`safeStorage`. Dev caveat: `setAsDefaultProtocolClient('nodescope')` registers the **dev binary** path
on Windows — confirm the registration when running unpackaged.

## Test

```bash
npm test     --workspace=apps/desktop   # vitest (main units + renderer RTL, jsdom)
npm run e2e  --workspace=apps/desktop    # Playwright-Electron (launch smoke); run after `build`
```

On a headless Linux/CI runner the e2e needs a virtual display and the sandbox off:
`ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a npm run e2e`. On Windows/macOS neither is needed.

## Build & package

```bash
npm run build       --workspace=apps/desktop   # electron-vite build -> out/
npm run package:win --workspace=apps/desktop    # electron-builder -> release/NodeScope Setup *.exe (Windows only)
```

The Windows NSIS installer is produced on a Windows runner (see `.github/workflows/desktop-build.yml`,
triggered manually or on a `v*` tag). mac/Linux targets are added later by extending
`electron-builder.yml`.

## Architecture (the Spec 3 seam)

- **State** is Zustand: `authStore` (token presence + org), `sitesStore` (the F2 property tree +
  selected building), and **`viewportStore`** (`activeBuildingPropertyId`) — the reserved boundary
  Spec 3's Three.js render loop reads/writes outside React.
- **`<ViewportHost>`** is the placeholder Spec 3 replaces with the react-three-fiber `<Canvas>`;
  Spec 4 adds the node-placement panels.

## 3D viewport (Spec 3)

`viewport/ifc/IfcModelLoader` parses an IFC `ArrayBuffer` into a `ParsedModel` — a recentered, **Y-up**
Three.js `Group` of per-element meshes grouped by IFC category (`expressID`-tagged), with a bbox, the
coordinate `frame` (`{ recenter, upConversion }`), lazy `getProperties`, and `dispose`. Parsing is
**client-side, main-thread (v1)** via [web-ifc](https://github.com/ThatOpen/engine_web-ifc) (Rust→WASM,
no Rust authored); the `web-ifc.wasm` is **bundled into the renderer** (served at the web root, not fetched
remotely). Off-main-thread parsing + geometry batching are a deliberate later pass behind the same loader
interface. `ParsedModel` / `ElementProperties` (`viewport/ifc/ifc-types.ts`) are the Spec 3 cross-phase
contract that Phase B (lifecycle), C (r3f scene), and D (interaction) — and Spec 4 (nodes) — build on.

The **load lifecycle** (`use-viewport-loader.ts`) walks `idle → loading → parsing → ready` (or `empty`
on `MODEL_001`, `error` on download/parse failure) keyed on the selected building, **race-safe** (a stale
resolve is discarded + disposed) with a **keep-last-1** in-memory model cache (toggling back is instant).
`data/clients.ts` exposes the bootstrapped REST + realtime clients (`getClients`) to the viewport hooks;
`use-model-realtime.ts` raises a non-intrusive *model-updated* banner on `v1:buildingModel:activated` /
`versionUploaded` for the open building (and reverts to *empty* on delete). `<ViewportHost>` switches on
the status and renders the matching overlay; the `ready` slot mounts the live r3f viewport.

The viewport renders via **react-three-fiber** (`viewport/scene/ViewportCanvas`): an r3f `<Canvas frameloop="demand">`
(a building is near-static, so frames render only on camera/state change — `invalidate()`), a hemisphere +
directional light rig, drei `<OrbitControls>` (orbit/pan/zoom), `<ModelView>` (a `<primitive>` of the parsed
`model.root`), and a `<CameraRig>` that **fits the model bbox** on load (`fitCameraToBox`). `gl.localClippingEnabled`
is set for Phase D's section plane. Headless scene tests use `@react-three/test-renderer` (no GPU); GPU/visual
correctness is verified manually. (`r3f-jsx.d.ts` re-registers r3f's `ThreeElements` on the JSX namespaces — r3f
v9's bundled types omit the augmentation.)

**Interaction** (`viewport/interaction`, `viewport/ui`): pointer-down raycasts the visible meshes
(`pickExpressId`) → `store.select`; `applyModelState` (pure) reflects selection (emissive highlight),
category/element hide + isolation (`mesh.visible`), and the section plane (`material.clippingPlanes`) onto the
per-element meshes, run by `<ModelView>` on store change. The docked **Inspector** shows the picked element's
IFC type/name/tag + property sets with Isolate / Hide / Zoom-to; the **Toolbar** has Fit, Show-all, a section
toggle (axis + position), and a per-category visibility list. Camera commands (Fit / Zoom-to) cross the DOM↔r3f
boundary via store nonces (`fitNonce`/`focusNonce`) consumed by an in-Canvas `<ViewCommands>`. The extended
`viewportStore` + the `ParsedModel` handle (with its recenter + Z-up→Y-up `frame`) are the **Spec 4 contract**.

## Nodes in 3D (Spec 4 — in progress)

Spec 4 layers network **device nodes** onto the Spec 3 viewport (the convergence of the 3D + permissions
tracks). **Phase A (foundations)** is in — the headless layer the marker/placement/panel phases build on:

- `viewport/nodes/node-coords.ts` — pure `toViewport(xyz)` / `toModel(point)` bridging a device's stored
  model-local `x/y/z` ↔ viewport world space via `ParsedModel.frame` (one `Rx(-90°)·T(-recenter)` matrix,
  round-trip tested). The coordinate contract for every 3D node feature.
- `viewport/nodes/node-status.ts` — the **status-display seam**: `NodeStatus` (`up|down|warning|unknown`)
  + a colour map. The **Monitoring spec** fills `viewportStore.nodeStatus`; **v1 renders every node `unknown`**.
- `viewport/nodes/filter-devices.ts` + `can-configure.ts` — the pure Node-panel filter (text/category/
  network/placement/floor/status) and the F3 role gate (`canConfigure` → OWNER/ADMIN; MEMBER view-only).
- `viewportStore.selection` is now a **tagged `element | device` union** (`selectElement`/`selectNode`/
  `clearSelection`), and the store carries node state (`devices`, `placingDeviceId`, `nodeFilter`,
  `nodeStatus`, `access`). Spec 3's pick/highlight/inspect consumers read the union.
- Data: `@nodescope/client.listDevicesForBuilding(buildingPropertyId)` (server `GET /v1/devices?
  buildingPropertyId=…`, F3 scope-filtered over the building subtree) + `setDevicePosition(id, pos|null)`
  (Spec 1's `PATCH /v1/devices/:id/position`).

Markers (`NodeLayer` + status ring), select-then-click placement, and the right-dock Node panel land in
Phases B–D. The server is the authority — placement runs F3's `assertCanConfigure`; the client gate only
hides affordances.
