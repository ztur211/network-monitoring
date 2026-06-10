# Spec 2 Phase C — Shell, Connectivity & Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the sidebar + viewport shell (top bar, site/building tree, `<ViewportHost>` placeholder), the Zustand stores (including the reserved `viewportStore` Spec 3 boundary), wire `@nodescope/client` to load the org + property tree + realtime on auth, add a Settings API-URL override, and package a Windows installer with electron-builder.

**Architecture:** Renderer-side React (DOM) + React Router. **Zustand** stores hold auth/sites/viewport state; a `useBootstrap` hook builds `@nodescope/client` (base URL from `app.getConfig()`, token from the preload bridge), loads `getOrganization()` + `listProperties()` into `sitesStore`, and connects the realtime client. The shell is presentational, reading the stores. `electron-builder` produces a Windows NSIS installer.

**Tech Stack:** React 19 DOM, React Router, Zustand, `@nodescope/client`, Vitest + React Testing Library, electron-builder.

**Depends on:** **Spec 2 Phase B** (the running Electron app + preload bridge + auth) and **Phase A** (`@nodescope/client`). F1a `GET /v1/organizations/me`, F2 `GET /v1/properties`. Spec: `2026-06-09-spec2-desktop-shell-design.md` (§4, §7, §8, §9, §10).

---

## File Structure

**Create:**
- `apps/desktop/src/renderer/stores/{auth-store,sites-store,viewport-store}.ts`
- `apps/desktop/src/renderer/data/clients.ts` (build REST + realtime clients) + `use-bootstrap.ts` (load on auth)
- `apps/desktop/src/renderer/shell/{TopBar,Sidebar,ViewportHost,Shell}.tsx`
- `apps/desktop/src/renderer/routes.tsx` (React Router) + `screens/{Login,Settings}.tsx`
- `apps/desktop/electron-builder.yml`
- tests under `src/renderer/**/__tests__/*.spec.tsx` (Vitest + RTL)

**Modify:**
- `apps/desktop/src/renderer/App.tsx` (mount the router)
- `apps/desktop/src/main/index.ts` + `config.ts` (Settings: persist + read an API-URL override)
- `apps/desktop/src/preload/index.ts` + `api.d.ts` (`app.setApiUrl`)
- `apps/desktop/vitest.config.ts` (jsdom environment for renderer tests)

---

## Task 1: Zustand stores (Vitest unit)

**Files:** `stores/{auth-store,sites-store,viewport-store}.ts`; tests `stores/__tests__/*.spec.ts`.

- [ ] **Step 1: Failing test** (`sites-store.spec.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { useSitesStore } from '../sites-store';
import type { PropertyDto } from '@nodescope/shared';

const prop = (id: string, type: string, parentId: string | null): PropertyDto =>
  ({ id, organizationId: 'o', parentId, type: type as any, name: id, code: null, version: 1, createdAt: '', updatedAt: '' });

describe('sitesStore', () => {
  it('stores the property list and tracks the selected building', () => {
    useSitesStore.getState().setProperties([prop('s', 'SITE', null), prop('b', 'BUILDING', 's')]);
    expect(useSitesStore.getState().properties).toHaveLength(2);
    useSitesStore.getState().selectBuilding('b');
    expect(useSitesStore.getState().selectedBuildingId).toBe('b');
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/desktop && npm test -- sites-store`.

- [ ] **Step 3: Implement the stores**

```typescript
// auth-store.ts
import { create } from 'zustand';
import type { OrganizationDto } from '@nodescope/shared';
interface AuthState { authed: boolean; org: OrganizationDto | null; setAuthed: (v: boolean) => void; setOrg: (o: OrganizationDto | null) => void; }
export const useAuthStore = create<AuthState>((set) => ({ authed: false, org: null, setAuthed: (authed) => set({ authed }), setOrg: (org) => set({ org }) }));
```

```typescript
// sites-store.ts
import { create } from 'zustand';
import type { PropertyDto } from '@nodescope/shared';
interface SitesState { properties: PropertyDto[]; selectedBuildingId: string | null; setProperties: (p: PropertyDto[]) => void; selectBuilding: (id: string | null) => void; }
export const useSitesStore = create<SitesState>((set) => ({ properties: [], selectedBuildingId: null,
  setProperties: (properties) => set({ properties }), selectBuilding: (selectedBuildingId) => set({ selectedBuildingId }) }));
```

```typescript
// viewport-store.ts — the reserved Spec 3 boundary (camera/selection added by Spec 3/4)
import { create } from 'zustand';
interface ViewportState { activeBuildingPropertyId: string | null; setActiveBuilding: (id: string | null) => void; }
export const useViewportStore = create<ViewportState>((set) => ({ activeBuildingPropertyId: null, setActiveBuilding: (activeBuildingPropertyId) => set({ activeBuildingPropertyId }) }));
```

- [ ] **Step 4: Run → PASS.** Commit `feat(desktop): zustand auth/sites/viewport stores`.

---

## Task 2: Client construction + bootstrap-on-auth (Vitest unit)

**Files:** `data/clients.ts`, `data/use-bootstrap.ts`; test `data/__tests__/use-bootstrap.spec.ts`.

- [ ] **Step 1: `clients.ts`** — build the clients from the bridge:

```typescript
import { createRestClient, createRealtimeClient } from '@nodescope/client';
export async function buildClients() {
  const { apiUrl } = await window.nodescope.app.getConfig();
  const getToken = () => window.nodescope.auth.getToken();
  return { rest: createRestClient({ baseUrl: apiUrl, getToken }), realtime: createRealtimeClient({ baseUrl: apiUrl, getToken }) };
}
```

- [ ] **Step 2: Failing test** (`use-bootstrap.spec.ts`) — on auth, it loads org + properties into the stores:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bootstrap } from '../use-bootstrap';
import { useSitesStore } from '../../stores/sites-store';
import { useAuthStore } from '../../stores/auth-store';

describe('bootstrap', () => {
  beforeEach(() => { useSitesStore.setState({ properties: [], selectedBuildingId: null }); });
  it('loads org + properties and connects realtime', async () => {
    const rest = { getOrganization: vi.fn().mockResolvedValue({ id: 'o', name: 'Acme' }), listProperties: vi.fn().mockResolvedValue([{ id: 'b' }]) };
    const realtime = { connect: vi.fn().mockResolvedValue(undefined), on: vi.fn() };
    await bootstrap({ rest, realtime } as any);
    expect(useAuthStore.getState().org).toEqual({ id: 'o', name: 'Acme' });
    expect(useSitesStore.getState().properties).toEqual([{ id: 'b' }]);
    expect(realtime.connect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run → FAIL.** `cd apps/desktop && npm test -- use-bootstrap`.

- [ ] **Step 4: Implement `use-bootstrap.ts`**

```typescript
import { useEffect } from 'react';
import { useAuthStore } from '../stores/auth-store';
import { useSitesStore } from '../stores/sites-store';
import { buildClients } from './clients';

type Clients = Awaited<ReturnType<typeof buildClients>>;

export async function bootstrap(clients: Clients): Promise<void> {
  const [org, properties] = await Promise.all([clients.rest.getOrganization(), clients.rest.listProperties()]);
  useAuthStore.getState().setOrg(org);
  useSitesStore.getState().setProperties(properties);
  await clients.realtime.connect();
  // entity events refresh the tree (kept simple: re-fetch properties on property/charter events)
  clients.realtime.on('v1:property:created', () => clients.rest.listProperties().then((p) => useSitesStore.getState().setProperties(p)));
}

/** React hook: bootstrap whenever auth flips true. */
export function useBootstrap(): void {
  const authed = useAuthStore((s) => s.authed);
  useEffect(() => { if (authed) buildClients().then(bootstrap).catch(() => {/* surfaced via re-auth */}); }, [authed]);
}
```

- [ ] **Step 5: Run → PASS.** Commit `feat(desktop): client bootstrap (org + properties + realtime on auth)`.

---

## Task 3: Shell components + router (Vitest + RTL)

**Files:** `shell/{TopBar,Sidebar,ViewportHost,Shell}.tsx`, `routes.tsx`, `screens/{Login,Settings}.tsx`; modify `App.tsx`; tests `shell/__tests__/*.spec.tsx`.

- [ ] **Step 1: Failing RTL test** (`Sidebar.spec.tsx`) — renders the building tree from `sitesStore` and selects on click:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../Sidebar';
import { useSitesStore } from '../../stores/sites-store';

describe('Sidebar', () => {
  it('lists buildings and selects one on click', () => {
    useSitesStore.setState({ properties: [
      { id: 's', type: 'SITE', parentId: null, name: 'HQ' } as any,
      { id: 'b', type: 'BUILDING', parentId: 's', name: 'Bld A' } as any,
    ], selectedBuildingId: null });
    render(<Sidebar />);
    fireEvent.click(screen.getByText('Bld A'));
    expect(useSitesStore.getState().selectedBuildingId).toBe('b');
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/desktop && npm test -- Sidebar` (ensure `vitest.config.ts` sets `test.environment: 'jsdom'`).

- [ ] **Step 3: Implement the shell** — presentational, reading stores:

```tsx
// Sidebar.tsx
import { useSitesStore } from '../stores/sites-store';
import { useViewportStore } from '../stores/viewport-store';
export function Sidebar() {
  const { properties, selectedBuildingId, selectBuilding } = useSitesStore();
  const setActive = useViewportStore((s) => s.setActiveBuilding);
  const sites = properties.filter((p) => p.type === 'SITE');
  return (
    <nav aria-label="Sites">
      {sites.map((site) => (
        <div key={site.id}>
          <div>{site.name}</div>
          {properties.filter((p) => p.parentId === site.id && p.type === 'BUILDING').map((b) => (
            <button key={b.id} data-selected={b.id === selectedBuildingId}
              onClick={() => { selectBuilding(b.id); setActive(b.id); }}>{b.name}</button>
          ))}
        </div>
      ))}
    </nav>
  );
}
```

```tsx
// ViewportHost.tsx — the Spec 3 boundary (placeholder for now)
import { useViewportStore } from '../stores/viewport-store';
export function ViewportHost() {
  const buildingId = useViewportStore((s) => s.activeBuildingPropertyId);
  return <main aria-label="viewport">{buildingId ? `3D viewport for ${buildingId} (Spec 3)` : 'Select a building'}</main>;
}
```

```tsx
// TopBar.tsx
import { useAuthStore } from '../stores/auth-store';
export function TopBar() {
  const org = useAuthStore((s) => s.org);
  return <header><span>NodeScope</span><span>{org?.name ?? ''}</span>
    <button onClick={() => window.nodescope.auth.logout()}>Sign out</button></header>;
}
```

`Shell.tsx` composes `<TopBar/>` + a flex row of `<Sidebar/>` + `<ViewportHost/>` and calls `useBootstrap()`. `routes.tsx` (React Router): `/login` → `<Login/>` (Phase B's Sign-in button), `/` → `<Shell/>` (redirect to `/login` when unauthed), `/settings` → `<Settings/>`. `App.tsx` mounts the router + subscribes `onAuthChanged` → `useAuthStore.setAuthed`.

- [ ] **Step 4: Run → PASS** (Sidebar + a TopBar logout test + a ViewportHost placeholder test). Commit `feat(desktop): sidebar + viewport shell + router`.

---

## Task 4: Settings — API-URL override

**Files:** modify `main/index.ts`, `main/config.ts`, `preload/index.ts` + `api.d.ts`, `screens/Settings.tsx`.

- [ ] **Step 1: Persist + read the override in main.** `config.ts` reads an override file:

```typescript
import { app } from 'electron';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
const SETTINGS = () => join(app.getPath('userData'), 'settings.json');
export function getApiUrl(): string {
  try { const s = JSON.parse(readFileSync(SETTINGS(), 'utf8')); if (s.apiUrl) return s.apiUrl; } catch { /* none */ }
  return process.env.VITE_API_URL ?? 'http://localhost:3000/api';
}
```

Add IPC `app:setApiUrl` (writes `settings.json`) and have `app:getConfig` return `{ apiUrl: getApiUrl() }`. (Changing it takes effect on next launch — the Settings screen notes "restart to apply".)

- [ ] **Step 2: Preload** — add `app.setApiUrl(url: string)` to the bridge + `api.d.ts`.

- [ ] **Step 3: `Settings.tsx`** — a form reading `app.getConfig()` and calling `app.setApiUrl()`; assert via an RTL test that submitting calls the bridge.

- [ ] **Step 4: Run → PASS.** Commit `feat(desktop): settings API-URL override (self-host)`.

---

## Task 5: Windows packaging (electron-builder)

**Files:** `apps/desktop/electron-builder.yml`; `package.json` script; CI note.

- [ ] **Step 1: `electron-builder.yml`**

```yaml
appId: io.nodescope.desktop
productName: NodeScope
directories: { output: release, buildResources: build }
files: ["out/**/*", "package.json"]
win:
  target: [{ target: nsis, arch: [x64] }]
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
```

- [ ] **Step 2: Package script.** Add to `apps/desktop/package.json`: `"package:win": "electron-vite build && electron-builder --win --config electron-builder.yml"`.

- [ ] **Step 3: Build the installer.** `cd apps/desktop && npm run package:win` → a `release/NodeScope Setup *.exe` is produced (run on Windows / a Windows CI runner). Add a CI job (`.github/workflows/`) that runs `package:win` on `windows-latest` and uploads the artifact.

- [ ] **Step 4: Commit** `feat(desktop): Windows NSIS packaging (electron-builder)`.

---

## Task 6: Phase gate + docs

- [ ] **Step 1: Suites.** `cd apps/desktop && npm run build && npm test && npm run e2e` → green.
- [ ] **Step 2: Docs (Rule 10).** `apps/desktop/README.md` (dev `electron-vite dev`; `package:win`; the `nodescope://` + Settings notes); update the SAD/CLAUDE.md that the monorepo now has a desktop app + `@nodescope/client`, and that `<ViewportHost>` + `viewportStore` are the Spec 3 seam.
- [ ] **Step 3: Commit** `docs: Spec 2 desktop shell (Phase C) + README`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** sidebar (F2 tree) + top bar (org name + logout) + `<ViewportHost>` placeholder (§4, §7) ✓ Task 3; Zustand `auth`/`sites`/`viewport` with the viewport boundary (§7) ✓ Task 1; `@nodescope/client` wired for org + properties + realtime on auth (§8) ✓ Task 2; Settings API-URL override (§9) ✓ Task 4; Windows NSIS packaging (§9) ✓ Task 5; React Router (§7) ✓ Task 3.
- **Boundary respected:** `<ViewportHost>` + `viewportStore` are the documented Spec 3 seam (Spec 3 swaps the placeholder for the r3f canvas, fetching via `getActiveModelFile`); Spec 4 adds placement panels. No 3D here.
- **Placeholder scan:** none — concrete code/commands; the viewport content is an intentional placeholder (stated).
- **Type consistency:** stores (`useAuthStore`/`useSitesStore`/`useViewportStore`) with their setters used consistently by `bootstrap` + the shell; `buildClients()` returns `{ rest, realtime }` consumed by `bootstrap`; `window.nodescope.app.{getConfig,setApiUrl}` matches `api.d.ts` (extended here); REST methods (`getOrganization`/`listProperties`) match Phase A's `@nodescope/client`.
- **Test-config compliance:** Vitest (`jsdom`) + RTL for renderer; Playwright (Phase B) for e2e.
- **Integration points to verify during execution:** `vitest.config.ts` `environment: 'jsdom'` for `.spec.tsx`; React Router v6 redirect pattern for the unauthed guard; that changing `apiUrl` rebuilds the clients (restart is the simplest contract; a live rebuild is optional); electron-builder needs a Windows runner to actually emit the `.exe`.

---

# Spec 2 — cross-plan self-review (all three phases)

- **Spec coverage (full):** §4 Electron architecture → Phase B (scaffold/window/processes) + Phase A/C wiring ✓ · §5 auth (system-browser/PKCE/`nodescope://`/safeStorage/bearer + server endpoints) → Phase A (server + bearer) + Phase B (client flow) ✓ · §6 `@nodescope/client` → Phase A ✓ · §7 shell/nav/state → Phase C ✓ · §8 connectivity → Phase C ✓ · §9 build/Windows packaging → Phase C ✓ · §10 public interface (`ViewportHost`/`viewportStore`/client/desktop-auth endpoints/preload bridge) → A+B+C ✓ · §11 security (contextIsolation/sandbox/PKCE/state/safeStorage) → A+B ✓ · §12 testing → each phase ✓.
- **Build-green order:** A (shared client + server auth, no Electron) → B (Electron app + auth against A) → C (shell + connectivity + packaging). Each phase ends green and is independently testable.
- **Cross-phase type consistency:** `@nodescope/client` surface (`createRestClient`/`createRealtimeClient`, `getOrganization`/`listProperties`/`getActiveModelFile`) defined in A, consumed in C; the preload bridge (`auth.*`, `app.getConfig/setApiUrl`) defined in B, extended + consumed in C; `AuthFlow`/`TokenVault` are B-internal. `nodescope://auth/callback` parsing identical to the server `redirect_uri`.
- **Flagged for execution:** the Better Auth `^1.0.0` API names (Phase A); the dev-vs-packaged `nodescope://` registration on Windows (Phase B); a Windows runner for the actual installer (Phase C).
