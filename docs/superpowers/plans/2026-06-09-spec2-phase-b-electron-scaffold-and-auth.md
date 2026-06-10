# Spec 2 Phase B — Electron Scaffold & Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the `apps/desktop` Electron app (electron-vite: main + preload + React-DOM renderer) and implement the full desktop auth flow in the main process — PKCE generation, system-browser launch, `nodescope://` protocol + single-instance routing, code exchange against Phase A's `/v1/desktop-auth/token`, and the `safeStorage` token vault — exposed to the renderer through a minimal typed preload bridge.

**Architecture:** The main process owns everything sensitive: a single `BrowserWindow` (`contextIsolation`, `sandbox`, no `nodeIntegration`), `setAsDefaultProtocolClient('nodescope')` + a single-instance lock, and an `AuthFlow` orchestrator with **injected** dependencies (`openExternal`, `fetch`, `TokenVault`, `onChange`) so its logic is unit-testable headless. The preload exposes `window.nodescope.auth.*` / `app.*` via `contextBridge`. The renderer is minimal here (login button + auth-state readout) — the real shell is Phase C.

**Tech Stack:** Electron + electron-vite, React 19 DOM, TypeScript, Vitest (main + renderer units), Playwright-Electron (e2e), Node `crypto`.

**Depends on:** **Spec 2 Phase A** — the `/v1/desktop-auth/{authorize,token}` endpoints + `@nodescope/client`. Spec: `2026-06-09-spec2-desktop-shell-design.md` (§4, §5).

> Greenfield: no Electron/electron-vite/Vitest exists yet. The renderer here is a stub; Phase C builds the sidebar/viewport shell.

---

## File Structure

**Create:**
- `apps/desktop/package.json`, `electron.vite.config.ts`, `tsconfig.json`, `vitest.config.ts`
- `apps/desktop/src/main/index.ts` (app/window/protocol/single-instance/IPC)
- `apps/desktop/src/main/auth/pkce.ts`, `token-vault.ts`, `auth-flow.ts`
- `apps/desktop/src/main/config.ts` (API base URL)
- `apps/desktop/src/preload/index.ts` + `apps/desktop/src/preload/api.d.ts` (renderer global types)
- `apps/desktop/src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx` (stub)
- `apps/desktop/src/main/auth/__tests__/{pkce,token-vault,auth-flow}.spec.ts`
- `apps/desktop/e2e/login.e2e.ts` (Playwright-Electron)

**Modify:** root `package.json` (workspace already globs `apps/*`; add a `dev:desktop` script).

---

## Task 1: electron-vite scaffold (window launches)

**Files:** the scaffold files above (minimal).

- [ ] **Step 1: `apps/desktop/package.json`**

```json
{
  "name": "@nodescope/desktop",
  "version": "0.1.0",
  "private": true,
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "test": "vitest run",
    "e2e": "playwright test",
    "lint": "tsc --noEmit"
  },
  "dependencies": { "@nodescope/client": "*", "@nodescope/shared": "*", "react": "19.2.6", "react-dom": "19.2.6", "react-router-dom": "^6.26.0", "zustand": "^5.0.0" },
  "devDependencies": { "electron": "^32.0.0", "electron-vite": "^2.3.0", "electron-builder": "^25.0.0", "@vitejs/plugin-react": "^4.3.0", "vitest": "^2.0.0", "@testing-library/react": "^16.0.0", "jsdom": "^25.0.0", "@playwright/test": "^1.47.0", "typescript": "^5.4.0", "@types/react": "~19.1.1" }
}
```

- [ ] **Step 2: `electron.vite.config.ts`**

```typescript
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  main: { build: { outDir: 'out/main' } },
  preload: { build: { outDir: 'out/preload' } },
  renderer: { plugins: [react()], build: { outDir: 'out/renderer' } },
});
```

- [ ] **Step 3: Minimal main/preload/renderer** so a window opens:

```typescript
// src/main/index.ts (minimal — expanded in Task 5)
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
```

```typescript
// src/preload/index.ts (minimal — expanded in Task 5)
import { contextBridge } from 'electron';
contextBridge.exposeInMainWorld('nodescope', { app: { ping: () => 'pong' } });
```

`src/renderer/index.html` (loads `main.tsx`), `src/renderer/main.tsx` (`createRoot(...).render(<App/>)`), `src/renderer/App.tsx` (`export default () => <div>NodeScope Desktop</div>`).

- [ ] **Step 4: Launch check.** `cd apps/desktop && npm run dev` → an Electron window opens showing "NodeScope Desktop". Commit `feat(desktop): electron-vite scaffold (main/preload/renderer)`.

---

## Task 2: PKCE helper (Vitest unit)

**Files:** `src/main/auth/pkce.ts`; test `__tests__/pkce.spec.ts`.

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createPkce } from '../pkce';

describe('createPkce', () => {
  it('produces a verifier and an S256 challenge = base64url(sha256(verifier))', () => {
    const { verifier, challenge } = createPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/desktop && npm test -- pkce`.

- [ ] **Step 3: Implement `pkce.ts`**

```typescript
import { createHash, randomBytes } from 'node:crypto';
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(desktop): PKCE helper`.

---

## Task 3: `TokenVault` (Vitest unit, mocked `safeStorage` + fs)

**Files:** `src/main/auth/token-vault.ts`; test `__tests__/token-vault.spec.ts`.

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
const store = new Map<string, Buffer>();
vi.mock('electron', () => ({ safeStorage: {
  encryptString: (s: string) => Buffer.from(`enc:${s}`),
  decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ''),
  isEncryptionAvailable: () => true,
} }));
vi.mock('node:fs', () => ({ promises: {
  writeFile: async (p: string, b: Buffer) => { store.set(p, b); },
  readFile: async (p: string) => { const b = store.get(p); if (!b) throw new Error('ENOENT'); return b; },
  rm: async (p: string) => { store.delete(p); },
} }));
import { TokenVault } from '../token-vault';

describe('TokenVault', () => {
  beforeEach(() => store.clear());
  it('saves encrypted and loads back; clear() removes it', async () => {
    const vault = new TokenVault('/tmp/auth.bin');
    expect(await vault.load()).toBeNull();
    await vault.save('TKN');
    expect(store.get('/tmp/auth.bin')!.toString().startsWith('enc:')).toBe(true);
    expect(await vault.load()).toBe('TKN');
    await vault.clear();
    expect(await vault.load()).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/desktop && npm test -- token-vault`.

- [ ] **Step 3: Implement `token-vault.ts`**

```typescript
import { safeStorage } from 'electron';
import { promises as fs } from 'node:fs';

export class TokenVault {
  constructor(private readonly file: string) {}
  async save(token: string): Promise<void> {
    await fs.writeFile(this.file, safeStorage.encryptString(token));
  }
  async load(): Promise<string | null> {
    try { return safeStorage.decryptString(await fs.readFile(this.file)); } catch { return null; }
  }
  async clear(): Promise<void> { await fs.rm(this.file, { force: true }); }
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(desktop): safeStorage token vault`.

---

## Task 4: `AuthFlow` orchestrator (Vitest unit, injected deps)

**Files:** `src/main/auth/auth-flow.ts`; test `__tests__/auth-flow.spec.ts`.

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { AuthFlow } from '../auth-flow';

function makeFlow(overrides = {}) {
  const openExternal = vi.fn().mockResolvedValue(undefined);
  const onChange = vi.fn();
  const vault = { save: vi.fn(), load: vi.fn(), clear: vi.fn() } as any;
  const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { token: 'TKN' } }) });
  const flow = new AuthFlow({ apiUrl: 'http://api', openExternal, fetchFn, vault, onChange });
  return { flow, openExternal, onChange, vault, fetchFn };
}

describe('AuthFlow', () => {
  it('login() opens the system browser to authorize with a PKCE challenge + state', async () => {
    const { flow, openExternal } = makeFlow();
    await flow.login();
    const url = new URL(openExternal.mock.calls[0][0]);
    expect(url.pathname.endsWith('/v1/desktop-auth/authorize')).toBe(true);
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('redirect_uri')).toBe('nodescope://auth/callback');
  });

  it('handleCallback() exchanges the code (matching state) → saves token → onChange(true)', async () => {
    const { flow, openExternal, fetchFn, vault, onChange } = makeFlow();
    await flow.login();
    const state = new URL(openExternal.mock.calls[0][0]).searchParams.get('state')!;
    await flow.handleCallback(`nodescope://auth/callback?code=CODE&state=${state}`);
    expect(fetchFn.mock.calls[0][0]).toBe('http://api/v1/desktop-auth/token');
    expect(vault.save).toHaveBeenCalledWith('TKN');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('handleCallback() rejects a state mismatch', async () => {
    const { flow } = makeFlow(); await flow.login();
    await expect(flow.handleCallback('nodescope://auth/callback?code=C&state=WRONG')).rejects.toThrow();
  });

  it('ignores non-callback deep links', async () => {
    const { flow, fetchFn } = makeFlow();
    await flow.handleCallback('nodescope://something/else');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/desktop && npm test -- auth-flow`.

- [ ] **Step 3: Implement `auth-flow.ts`**

```typescript
import { randomBytes } from 'node:crypto';
import { createPkce } from './pkce';

interface AuthFlowDeps {
  apiUrl: string;
  openExternal: (url: string) => Promise<void>;
  fetchFn: typeof fetch;
  vault: { save(t: string): Promise<void>; load(): Promise<string | null>; clear(): Promise<void> };
  onChange: (authed: boolean) => void;
}

export class AuthFlow {
  private pending: { verifier: string; state: string } | null = null;
  constructor(private readonly deps: AuthFlowDeps) {}

  async login(): Promise<void> {
    const { verifier, challenge } = createPkce();
    const state = randomBytes(16).toString('base64url');
    this.pending = { verifier, state };
    const redirect = encodeURIComponent('nodescope://auth/callback');
    await this.deps.openExternal(
      `${this.deps.apiUrl}/v1/desktop-auth/authorize?code_challenge=${challenge}&code_challenge_method=S256&state=${state}&redirect_uri=${redirect}`,
    );
  }

  async handleCallback(rawUrl: string): Promise<void> {
    let u: URL;
    try { u = new URL(rawUrl); } catch { return; }
    if (u.protocol !== 'nodescope:' || `${u.host}${u.pathname}` !== 'auth/callback') return; // not our callback
    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    if (!this.pending || !code || state !== this.pending.state) throw new Error('AUTH_STATE_MISMATCH');
    const res = await this.deps.fetchFn(`${this.deps.apiUrl}/v1/desktop-auth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: this.pending.verifier }),
    });
    const json: any = await res.json();
    if (!res.ok || !json?.data?.token) throw new Error('AUTH_EXCHANGE_FAILED');
    await this.deps.vault.save(json.data.token);
    this.pending = null;
    this.deps.onChange(true);
  }

  getToken(): Promise<string | null> { return this.deps.vault.load(); }
  async logout(): Promise<void> { await this.deps.vault.clear(); this.deps.onChange(false); }
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(desktop): AuthFlow (PKCE login + nodescope:// callback exchange)`.

---

## Task 5: Main wiring — protocol, single-instance, IPC + preload bridge

**Files:** expand `src/main/index.ts`, `src/main/config.ts`; expand `src/preload/index.ts` + `api.d.ts`.

- [ ] **Step 1: `config.ts`** — `export const apiUrl = process.env.VITE_API_URL ?? 'http://localhost:3000/api';` (overridable by a stored setting in Phase C).

- [ ] **Step 2: Expand `main/index.ts`** — single-instance lock, protocol registration, deep-link routing into `AuthFlow`, IPC handlers, window reference:

```typescript
import { app, BrowserWindow, shell, ipcMain, safeStorage } from 'electron';
import { join } from 'node:path';
import { apiUrl } from './config';
import { TokenVault } from './auth/token-vault';
import { AuthFlow } from './auth/auth-flow';

let win: BrowserWindow | null = null;
const vault = new TokenVault(join(app.getPath('userData'), 'auth.bin'));
const flow = new AuthFlow({
  apiUrl, openExternal: (u) => shell.openExternal(u), fetchFn: fetch, vault,
  onChange: (authed) => win?.webContents.send('auth:changed', authed),
});

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.setAsDefaultProtocolClient('nodescope');
  // Windows/Linux: the deep link arrives as argv on the second launch
  app.on('second-instance', (_e, argv) => {
    const url = argv.find((a) => a.startsWith('nodescope://'));
    if (url) flow.handleCallback(url).catch(() => {});
    win?.focus();
  });
  // macOS: deep link via open-url
  app.on('open-url', (_e, url) => { flow.handleCallback(url).catch(() => {}); });

  app.whenReady().then(() => {
    ipcMain.handle('auth:login', () => flow.login());
    ipcMain.handle('auth:logout', () => flow.logout());
    ipcMain.handle('auth:getToken', () => flow.getToken());
    ipcMain.handle('app:getConfig', () => ({ apiUrl }));
    win = new BrowserWindow({ width: 1280, height: 800, webPreferences: {
      preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
    else win.loadFile(join(__dirname, '../renderer/index.html'));
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
```

- [ ] **Step 3: Preload bridge** (`src/preload/index.ts`)

```typescript
import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('nodescope', {
  auth: {
    login: () => ipcRenderer.invoke('auth:login'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    getToken: () => ipcRenderer.invoke('auth:getToken') as Promise<string | null>,
    onAuthChanged: (cb: (authed: boolean) => void) => {
      const listener = (_e: unknown, authed: boolean) => cb(authed);
      ipcRenderer.on('auth:changed', listener);
      return () => ipcRenderer.removeListener('auth:changed', listener);
    },
  },
  app: { getConfig: () => ipcRenderer.invoke('app:getConfig') as Promise<{ apiUrl: string }> },
});
```

`src/preload/api.d.ts` declares `interface Window { nodescope: { auth: {...}; app: {...} } }` so the renderer is typed.

- [ ] **Step 4: Dev smoke** — `npm run dev`; in devtools console `await window.nodescope.app.getConfig()` returns `{ apiUrl }`; `window.nodescope.auth.login()` opens the system browser to `/v1/desktop-auth/authorize`. Commit `feat(desktop): protocol + single-instance + IPC auth bridge`.

---

## Task 6: Minimal renderer auth state + Playwright e2e + phase gate

**Files:** expand `src/renderer/App.tsx`; `e2e/login.e2e.ts`; `playwright.config.ts`.

- [ ] **Step 1: Minimal auth-aware renderer** — `App.tsx` shows a Login button when unauthed and "Signed in" when authed, driven by the bridge:

```tsx
import { useEffect, useState } from 'react';
export default function App() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    window.nodescope.auth.getToken().then((t) => setAuthed(!!t));
    return window.nodescope.auth.onAuthChanged(setAuthed);
  }, []);
  return authed
    ? <div>Signed in</div>
    : <button onClick={() => window.nodescope.auth.login()}>Sign in</button>;
}
```

(A renderer Vitest test with `@testing-library/react` + a stubbed `window.nodescope` asserts the button calls `login()` and the "Signed in" state renders on `onAuthChanged(true)`.)

- [ ] **Step 2: Playwright-Electron e2e** (`e2e/login.e2e.ts`) — launch the built app, assert the window shows "Sign in"; with a stubbed `auth:getToken` returning a token, assert "Signed in" renders. (Full browser round-trip is out of scope for the e2e; the AuthFlow unit tests cover the exchange logic.)

```typescript
import { test, expect, _electron as electron } from '@playwright/test';
test('launches to the signed-out shell', async () => {
  const app = await electron.launch({ args: ['out/main/index.js'] });
  const win = await app.firstWindow();
  await expect(win.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await app.close();
});
```

- [ ] **Step 3: Phase gate.** `cd apps/desktop && npm run build && npm test` green; `npm run e2e` green (after `npm run build`).
- [ ] **Step 4: Commit** `feat(desktop): auth-aware renderer stub + Playwright e2e`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** electron-vite main/preload/renderer, `contextIsolation`/`sandbox`/no-`nodeIntegration`, single window (§4) ✓ Tasks 1, 5; `nodescope://` + single-instance + `open-url`/`second-instance` (§4, §5) ✓ Task 5; PKCE + system-browser login + code exchange + `safeStorage` vault (§5) ✓ Tasks 2–4; preload bridge `auth.login/logout/getToken/onAuthChanged` + `app.getConfig` (§4, §10) ✓ Tasks 5–6.
- **Deferred (correctly NOT here):** the sidebar/topbar/`ViewportHost` shell, Zustand stores, `@nodescope/client` wiring (org/properties/realtime), Settings override, electron-builder packaging → Phase C.
- **Placeholder scan:** none — concrete code/commands; the renderer is intentionally a stub (full shell = Phase C), stated as such.
- **Type consistency:** `AuthFlow({ apiUrl, openExternal, fetchFn, vault, onChange })` + `login/handleCallback/getToken/logout`; `TokenVault(file)` `save/load/clear`; preload `window.nodescope.{auth,app}` matches `api.d.ts` and the renderer usage; `nodescope://auth/callback` parsed as `host+pathname === 'auth/callback'`.
- **Test-config compliance:** Vitest for main + renderer units; Playwright for the Electron e2e (separate from the API's Jest).
- **Integration points to verify during execution:** electron-vite output paths (`out/{main,preload,renderer}`) match the `BrowserWindow` `preload` + `loadFile` paths; `app.setAsDefaultProtocolClient('nodescope')` dev-vs-packaged registration on Windows (may need `process.execPath` + args in dev); global `fetch` availability in the Electron main process (Node 18+/Electron 32 — yes); `@nodescope/client` consumed from source vs built `dist` by the renderer's Vite.
