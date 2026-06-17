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
