# Spec 2 — Desktop Shell (Electron App Foundation)

- **Status:** Draft for review
- **Date:** 2026-06-09
- **Spec:** Spec 2 (3D/spatial track — second; the Electron shell that Spec 3's viewport and Spec 4's node placement live inside)
- **Depends on:**
  - **F1a** *Public Interface* — Better Auth, `OrganizationMember`, `GET /v1/organizations/me`, the `{ success, data, timestamp }` envelope, the `org:{organizationId}` realtime room.
  - **F2** *Public Interface* — `GET /v1/properties` (the site/building tree for the sidebar).
  - **Spec 1** *Public Interface* — `@nodescope/client` will expose the building-model download (`GET /v1/buildings/:propertyId/model/active/file`) that Spec 3 consumes.
  - **`@nodescope/shared`** — DTOs + `WS_EVENTS`.
- **Downstream consumers:** **Spec 3** (3D viewport — replaces the viewport placeholder, downloads the `BuildingModel`), **Spec 4** (nodes in 3D — placement UI in the shell). Read only the *Public Interface* (§10).

---

## 1. Context

The pivot adds a **desktop-first 3D client** alongside the existing 2D web app. The web app is Expo / React-Native-Web (MapLibre 2D map, `better-auth/react` cookie sessions) and stays untouched. There is no desktop code today (`apps/` = `api` + `web`; `packages/` = `shared` only).

Spec 2 builds the **Electron shell**: the app scaffold, authentication, API + realtime connectivity, navigation, state foundation, and Windows packaging — with a **placeholder** where the 3D viewport (Spec 3) and node-placement UI (Spec 4) will land. It does not render 3D. It also adds a small **server-side desktop-auth endpoint pair** so a native app can log in via the system browser.

## 2. Goals

1. A new `apps/desktop` Electron app (main + preload + React-DOM renderer) built with **electron-vite**, `contextIsolation` on, no `nodeIntegration`.
2. **System-browser OAuth-style auth** with PKCE and a `nodescope://` deep-link callback; the resulting session token is stored in Electron `safeStorage` and sent as `Authorization: Bearer` on REST + realtime.
3. A new **`@nodescope/client`** shared package (REST + realtime clients, token-provider-injected) — consumed by the desktop now, adoptable by the web later.
4. The **sidebar + main-viewport** shell: top bar (org context + user menu), left site/building tree (F2), and a viewport-placeholder region; **Zustand** state.
5. **Windows** packaging (electron-builder NSIS); the architecture stays cross-platform for later mac/Linux.

## 3. Non-Goals (explicitly out of scope for Spec 2)

- **3D rendering / the viewport / react-three-fiber / web-ifc** → Spec 3 (Spec 2 ships only a placeholder component + the state boundary).
- **Node placement / authoring UI** → Spec 4.
- **macOS / Linux packaging** (Windows-only v1; architecture stays portable).
- **Auto-update, crash reporting, offline caching** — later (§14).
- **Migrating the web app** to `@nodescope/client` (the package is created here; web adopts later).
- **SSO/SAML** — the system-browser flow is SSO-ready, but SSO itself is later.

## 4. App Architecture

`apps/desktop`, built with **electron-vite** (Vite for `main` / `preload` / `renderer`, HMR in dev), TypeScript throughout.

- **Main process** (Node): single `BrowserWindow` (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`); registers `nodescope://` (`app.setAsDefaultProtocolClient`); holds a **single-instance lock** so a second launch / deep link routes to the running app (`open-url` on macOS, `second-instance` argv parsing on Windows); owns the PKCE login launch and the `safeStorage` token vault.
- **Preload**: exposes a minimal, typed bridge via `contextBridge` — `auth.login()`, `auth.logout()`, `auth.getToken()`, `auth.onAuthChanged(cb)`, and `app.getConfig()`. No raw `ipcRenderer` or Node in the renderer.
- **Renderer**: the React-DOM shell. No Node access. Talks to the API only through `@nodescope/client`, fed the token via the preload bridge.

```
apps/desktop/
  src/main/      index.ts (window, protocol, single-instance), auth/ (pkce, login, token-vault), ipc/
  src/preload/   index.ts (contextBridge surface)
  src/renderer/  app/ (router, shell, sidebar, topbar, viewport-placeholder), stores/ (zustand), main.tsx
  electron.vite.config.ts · electron-builder.yml
```

## 5. Authentication (system-browser OAuth + PKCE + `nodescope://`)

**Client (main process):**
1. Renderer calls `auth.login()` → main generates a PKCE `verifier` + `challenge = base64url(SHA256(verifier))` and a random `state`.
2. Main opens the **system browser** (`shell.openExternal`) to `GET {API}/v1/desktop-auth/authorize?code_challenge={challenge}&code_challenge_method=S256&state={state}&redirect_uri=nodescope://auth/callback`.
3. After login the browser redirects to `nodescope://auth/callback?code={code}&state={state}`; the OS hands it to the app; main verifies `state`, then `POST {API}/v1/desktop-auth/token { code, code_verifier }` → `{ token, expiresAt }`.
4. Main stores the token via `safeStorage.encryptString` to `userData/auth.bin`; notifies the renderer (`onAuthChanged`).

**Server (new — a small addition to the API auth layer):**
- `GET /v1/desktop-auth/authorize` — records `{ challenge, state, redirect_uri }`, runs the standard Better Auth browser login (real cookies/origin), and on success mints a **one-time, short-lived code** bound to `(challenge, userId)`, redirecting to `redirect_uri?code&state`.
- `POST /v1/desktop-auth/token` — validates the code (one-time, unexpired) and `SHA256(code_verifier) == challenge`, then issues a **session/bearer token** for that user → `{ token, expiresAt }`. (Reuses Better Auth's session/bearer issuance.)
- `POST /v1/desktop-auth/revoke` — invalidates the token (logout).

**Runtime:** `@nodescope/client` sends `Authorization: Bearer <token>`; on `401` the client clears the token and signals the renderer to re-run `auth.login()`. (Token refresh vs full re-login is a §14 detail.)

## 6. `@nodescope/client` shared package

`packages/client` (`@nodescope/client`), framework-agnostic (no Electron/Expo coupling):
- **`createRestClient({ baseUrl, getToken })`** — fetch-based, attaches `Authorization` from `getToken()`, unwraps the `{ success, data }` envelope, maps `{ success:false, error }` to a typed `ApiError`. Typed methods for the endpoints the desktop needs now: `getOrganization()`, `listProperties()`, `getBuildingModel(propertyId)`, `getActiveModelFile(propertyId)` (Spec 1).
- **`createRealtimeClient({ baseUrl, getToken })`** — socket.io-client wrapper; sends the token in the handshake `auth`; typed `on(event, handler)` over `@nodescope/shared` `WS_EVENTS`; reconnect handling.
- Re-exports `@nodescope/shared` types. Tree-shakeable; no DOM/Node assumptions beyond `fetch` + `WebSocket` (present in the Electron renderer).

## 7. Shell, Navigation & State

- **Layout:** top bar (org name + user menu with logout) · left **sidebar** (the F2 site/building tree from `listProperties()`, plus a *Devices* entry) · **main region** = `<ViewportHost>`, a placeholder component Spec 3 replaces with the r3f canvas.
- **Navigation:** React Router in the renderer — `/login` (pre-auth), `/` (shell; selecting a building sets the active building in state), `/settings`. Minimal.
- **State (Zustand):** `authStore` (token presence + current user/org), `sitesStore` (the property tree + selected building), and a reserved **`viewportStore`** whose shape is the Spec 3 boundary (camera, loaded-model handle, selection) — Zustand is chosen so Spec 3's Three.js render loop can read/write outside React's render cycle.

## 8. Connectivity

On `onAuthChanged(authed)`, the renderer constructs `createRestClient`/`createRealtimeClient` with the configured API base URL + `getToken`, loads `getOrganization()` + `listProperties()` into the stores (sidebar), and subscribes to realtime (the `org:{organizationId}` room today; F3 scope-filtering applies automatically once F3 ships). On `401`/disconnect it surfaces a re-auth prompt.

## 9. Build & Packaging

- **Dev:** `electron-vite dev` (renderer HMR + main/preload reload).
- **Package:** `electron-builder` → **Windows NSIS** installer for v1. `electron.vite.config.ts` + `electron-builder.yml` carry the targets; mac/Linux are added later by extending the targets (no architecture change).
- **Config:** API base URL via build-time env (`VITE_API_URL`) with an in-app **Settings** override (persisted to `userData`), so a self-hoster can point the app at their server.
- **CI:** a Windows job builds the installer artifact.

## 10. Public Interface (the contract Spec 3 / Spec 4 build on)

- **`<ViewportHost>`** — the placeholder component in the main region; Spec 3 replaces its internals with the r3f `<Canvas>`. Its props/mount contract (the active building + model handle) is read from `viewportStore`.
- **`viewportStore` (Zustand)** — the React↔render-loop boundary: `{ activeBuildingPropertyId, modelFileUrl, camera, selection, setX… }`. Spec 3 owns the loop that consumes/updates it; Spec 4 adds placement actions.
- **`@nodescope/client`** — `getActiveModelFile(propertyId)` (Spec 3 downloads the IFC), `listProperties()`, the realtime client; `getToken()` for any new authed calls.
- **Server desktop-auth endpoints** — `GET /v1/desktop-auth/authorize`, `POST /v1/desktop-auth/token`, `POST /v1/desktop-auth/revoke`.
- **Preload bridge** — `window.nodescope.{ auth.login/logout/getToken/onAuthChanged, app.getConfig }` (typed `.d.ts` shipped for the renderer).

## 11. Security Considerations

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; the renderer reaches Node only through the explicit, minimal preload bridge.
- The token never lives in renderer JS storage — it is held in the main process and persisted via OS-encrypted `safeStorage`; the renderer fetches it on demand through the bridge.
- **PKCE** (S256) + a `state` nonce + a one-time, short-lived server code prevent code interception/replay on the `nodescope://` redirect. The custom scheme is validated and the `state` is checked before any exchange.
- Login happens in the **system browser** (real origin, password managers, no embedded credentials), and `Authorization: Bearer` is sent only to the configured API origin.
- `shell.openExternal` is used only for the constructed auth URL; deep-link inputs are parsed defensively (reject malformed/unknown paths).

## 12. Testing

- **Renderer (Vitest + React Testing Library):** shell renders the sidebar from a mocked `listProperties()`; login button triggers `auth.login()`; authed vs unauthed routing; Zustand store transitions.
- **`@nodescope/client` (Vitest):** REST client attaches the bearer token + unwraps envelope/maps `ApiError` (mocked `fetch`); realtime client sends the token in the handshake + dispatches typed events (mocked socket).
- **Main (Vitest/node):** PKCE `challenge` = `base64url(SHA256(verifier))`; `nodescope://auth/callback` URL parsing (code/state extraction, reject malformed); `state` mismatch aborts; token-vault encrypt/decrypt round-trip (mock `safeStorage`).
- **Server desktop-auth (Jest e2e, API):** `authorize` issues a one-time code; `token` rejects a wrong `code_verifier` / reused / expired code, accepts a valid one and returns a usable bearer token.
- **Electron e2e (Playwright, minimal):** app launches to `/login`; with a mocked desktop-auth server the happy-path login lands on the shell with the sidebar populated.

## 13. Documentation (Rule 10)

- Add the `/v1/desktop-auth/*` endpoints to the API Design Document; note the desktop bearer-token auth path alongside the web cookie path.
- New `apps/desktop/README.md` (dev: `electron-vite dev`; build: Windows installer; the `nodescope://` registration caveats) and a `packages/client/README.md`.
- Update the SAD/CLAUDE.md: the monorepo now has a desktop app + a shared client package; the desktop is React-DOM + Electron (distinct from the RN-Web app).

## 14. Open Questions (non-blocking; resolve during writing-plans / implementation)

- **Token refresh vs re-login:** whether to issue a refresh token / silent renewal, or simply re-run the browser flow on expiry (v1 assumes re-login on `401`).
- **mac/Linux packaging + signing/notarization:** deferred; add targets when needed.
- **Auto-update** (electron-updater) and crash reporting: later.
- **Deep-link hardening in dev:** `setAsDefaultProtocolClient` needs the dev binary path/args on Windows; confirm the dev-vs-packaged registration recipe during implementation.
- **Web adoption of `@nodescope/client`:** when/whether to migrate the Expo app's `lib/*` clients onto the shared package.
