# Spec 3 Phase B — Viewport Store, Load Lifecycle & States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Spec 2's reserved `viewport-store` with the full Spec 3 state machine (status / model / selection / visibility / section); add the pure derivations (`isMeshVisible`, `sectionToPlane`); implement the load lifecycle (metadata → empty/download → parse → ready, with race-safety + a keep-last-1 model cache + disposal); and render the state overlays (idle / loading / parsing / empty / error) plus the realtime "model updated — reload" banner. No WebGL yet — the `ready` state shows a placeholder Phase C replaces with the canvas.

**Architecture:** The store (Zustand) is the React↔render-loop bridge. A testable `loadBuilding()` function runs the lifecycle against an injected REST client + `IfcModelLoader`, guarded by an `isCurrent()` race token; `createModelCache()` keeps the last model so toggling back is instant. The `useViewportLoader` hook wires `loadBuilding` to `activeBuildingPropertyId` (+ a `reloadNonce`); `useModelRealtime` flags updates from the org realtime room. Overlays are presentational, switching on `status`.

**Tech Stack:** React 19 DOM, Zustand, `three` (Box3/Plane in pure helpers), Vitest + React Testing Library (jsdom), `@nodescope/client` + `@nodescope/shared`.

**Depends on:**
- **Phase A** — `IfcModelLoader`, `ParsedModel`, `ElementProperties`, `IfcType`, `ExpressId`, `createIfcModelLoader`.
- **Spec 2** — `stores/viewport-store.ts` (the reserved `{ activeBuildingPropertyId, setActiveBuilding }`), `shell/ViewportHost.tsx`, `data/clients.ts` (`buildClients`), `data/use-bootstrap.ts`, the realtime client + `@nodescope/shared` `WS_EVENTS`.
- **Spec 1 Public Interface** — `rest.getBuildingModel(propertyId)` (throws `ApiError` `code='MODEL_001'` when none), `rest.getActiveModelFile(propertyId): Promise<ArrayBuffer>`, the `v1:buildingModel:activated|versionUploaded|deleted` events.
- Spec: `docs/superpowers/specs/2026-06-11-spec3-3d-viewport-design.md` (§4, §8, §9, §11).

---

## File Structure

**Create:**
- `apps/desktop/src/renderer/viewport/interaction/visibility.ts` — pure `isMeshVisible`
- `apps/desktop/src/renderer/viewport/interaction/section.ts` — pure `sectionToPlane`
- `apps/desktop/src/renderer/viewport/use-viewport-loader.ts` — `loadBuilding`, `createModelCache`, `useViewportLoader`
- `apps/desktop/src/renderer/viewport/use-model-realtime.ts` — `useModelRealtime`
- `apps/desktop/src/renderer/viewport/ui/overlays/{Idle,Loading,Empty,ErrorState,UpdateBanner}.tsx`
- tests under `viewport/**/__tests__/*.spec.ts(x)`

**Modify:**
- `apps/desktop/src/renderer/stores/viewport-store.ts` — extend with the Spec 3 state + actions
- `apps/desktop/src/renderer/shell/ViewportHost.tsx` — switch on `status`, render overlays + the (placeholder) ready slot + banner
- `apps/desktop/src/renderer/data/clients.ts` — expose the built clients via `setClients`/`getClients` (so the viewport hooks reach them)

---

## Task 1: Extend `viewport-store.ts` (Vitest unit)

**Files:** Modify `stores/viewport-store.ts`; test `stores/__tests__/viewport-store.spec.ts`.

- [ ] **Step 1: Failing test** `stores/__tests__/viewport-store.spec.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useViewportStore, initialViewportState } from '../viewport-store';

const reset = () => useViewportStore.setState(initialViewportState(), true);

describe('viewportStore (Spec 3)', () => {
  beforeEach(reset);

  it('toggles a category on and off (new Set each time)', () => {
    const before = useViewportStore.getState().hiddenCategories;
    useViewportStore.getState().toggleCategory('IFCWALL');
    expect(useViewportStore.getState().hiddenCategories.has('IFCWALL')).toBe(true);
    expect(useViewportStore.getState().hiddenCategories).not.toBe(before); // immutable
    useViewportStore.getState().toggleCategory('IFCWALL');
    expect(useViewportStore.getState().hiddenCategories.has('IFCWALL')).toBe(false);
  });

  it('isolate / clearIsolation and hideElement', () => {
    useViewportStore.getState().isolate(42);
    expect(useViewportStore.getState().isolated).toBe(42);
    useViewportStore.getState().hideElement(7);
    expect(useViewportStore.getState().hiddenElements.has(7)).toBe(true);
    useViewportStore.getState().showAll();
    expect(useViewportStore.getState().isolated).toBeNull();
    expect(useViewportStore.getState().hiddenElements.size).toBe(0);
    expect(useViewportStore.getState().hiddenCategories.size).toBe(0);
  });

  it('setSection merges partials', () => {
    useViewportStore.getState().setSection({ enabled: true, axis: 'X', constant: 3 });
    expect(useViewportStore.getState().section).toEqual({ enabled: true, axis: 'X', constant: 3 });
    useViewportStore.getState().setSection({ constant: 5 });
    expect(useViewportStore.getState().section).toEqual({ enabled: true, axis: 'X', constant: 5 });
  });

  it('switching the active building resets per-model state', () => {
    useViewportStore.getState().select(9);
    useViewportStore.getState().isolate(9);
    useViewportStore.getState().toggleCategory('IFCSLAB');
    useViewportStore.getState().setActiveBuilding('bld-2');
    const s = useViewportStore.getState();
    expect(s.activeBuildingPropertyId).toBe('bld-2');
    expect(s.selection).toBeNull();
    expect(s.isolated).toBeNull();
    expect(s.hiddenCategories.size).toBe(0);
  });

  it('reload bumps the nonce and clears updateAvailable', () => {
    useViewportStore.getState().flagUpdate();
    const n = useViewportStore.getState().reloadNonce;
    useViewportStore.getState().reload();
    expect(useViewportStore.getState().updateAvailable).toBe(false);
    expect(useViewportStore.getState().reloadNonce).toBe(n + 1);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/desktop && npm test -- viewport-store`.

- [ ] **Step 3: Implement the extended store** `stores/viewport-store.ts` (replaces Spec 2's minimal version; keeps `activeBuildingPropertyId` + `setActiveBuilding`):

```typescript
import { create } from 'zustand';
import type { ParsedModel, IfcType, ExpressId } from '../viewport/ifc/ifc-types';

export type ViewportStatus = 'idle' | 'loading' | 'parsing' | 'ready' | 'empty' | 'error';
export interface SectionState { enabled: boolean; axis: 'X' | 'Y' | 'Z'; constant: number }

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
  // Spec 3 interaction state:
  selection: ExpressId | null;
  hiddenCategories: Set<IfcType>;
  isolated: ExpressId | null;
  hiddenElements: Set<ExpressId>;
  section: SectionState;
  // actions:
  select: (id: ExpressId | null) => void;
  isolate: (id: ExpressId) => void;
  clearIsolation: () => void;
  toggleCategory: (t: IfcType) => void;
  hideElement: (id: ExpressId) => void;
  showAll: () => void;
  setSection: (s: Partial<SectionState>) => void;
  flagUpdate: () => void;
  reload: () => void;
  // internal (lifecycle) setters:
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
  selection: null,
  hiddenCategories: new Set<IfcType>(),
  isolated: null,
  hiddenElements: new Set<ExpressId>(),
  section: { enabled: false, axis: 'Y' as const, constant: 0 },
});

export const useViewportStore = create<ViewportState>((set) => ({
  ...initialViewportState(),
  setActiveBuilding: (activeBuildingPropertyId) =>
    set({ activeBuildingPropertyId, selection: null, isolated: null,
          hiddenCategories: new Set(), hiddenElements: new Set(), updateAvailable: false }),
  select: (selection) => set({ selection }),
  isolate: (isolated) => set({ isolated }),
  clearIsolation: () => set({ isolated: null }),
  toggleCategory: (t) => set((s) => {
    const n = new Set(s.hiddenCategories); n.has(t) ? n.delete(t) : n.add(t); return { hiddenCategories: n };
  }),
  hideElement: (id) => set((s) => { const n = new Set(s.hiddenElements); n.add(id); return { hiddenElements: n }; }),
  showAll: () => set({ hiddenCategories: new Set(), hiddenElements: new Set(), isolated: null }),
  setSection: (p) => set((s) => ({ section: { ...s.section, ...p } })),
  flagUpdate: () => set({ updateAvailable: true }),
  reload: () => set((s) => ({ updateAvailable: false, reloadNonce: s.reloadNonce + 1 })),
  _setStatus: (status, error = null) => set({ status, error }),
  _setModel: (model) => set({ model }),
}));
```

- [ ] **Step 4: Run → PASS.** Commit `feat(desktop): extend viewportStore with Spec 3 lifecycle + interaction state`.

---

## Task 2: Pure derivations — `isMeshVisible`, `sectionToPlane` (Vitest unit)

**Files:** Create `interaction/visibility.ts`, `interaction/section.ts`; tests `interaction/__tests__/{visibility,section}.spec.ts`.

- [ ] **Step 1: Failing test** `interaction/__tests__/visibility.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { isMeshVisible } from '../visibility';

const mesh = (expressID: number, ifcType: string) =>
  Object.assign(new THREE.Mesh(), { userData: { expressID, ifcType } });

describe('isMeshVisible', () => {
  const base = { hiddenCategories: new Set<string>(), hiddenElements: new Set<number>(), isolated: null as number | null };
  it('visible by default', () => expect(isMeshVisible(mesh(1, 'IFCWALL'), base)).toBe(true));
  it('hidden when its category is hidden', () =>
    expect(isMeshVisible(mesh(1, 'IFCWALL'), { ...base, hiddenCategories: new Set(['IFCWALL']) })).toBe(false));
  it('hidden when individually hidden', () =>
    expect(isMeshVisible(mesh(1, 'IFCWALL'), { ...base, hiddenElements: new Set([1]) })).toBe(false));
  it('isolation hides everything except the isolated element', () => {
    expect(isMeshVisible(mesh(1, 'IFCWALL'), { ...base, isolated: 2 })).toBe(false);
    expect(isMeshVisible(mesh(2, 'IFCWALL'), { ...base, isolated: 2 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/desktop && npm test -- visibility`.

- [ ] **Step 3: Implement** `interaction/visibility.ts`:

```typescript
import type * as THREE from 'three';
import type { IfcType, ExpressId } from '../ifc/ifc-types';

export interface VisibilityState {
  hiddenCategories: Set<IfcType>;
  hiddenElements: Set<ExpressId>;
  isolated: ExpressId | null;
}

export function isMeshVisible(mesh: THREE.Mesh, s: VisibilityState): boolean {
  const { expressID, ifcType } = mesh.userData as { expressID: ExpressId; ifcType: IfcType };
  if (s.hiddenCategories.has(ifcType)) return false;
  if (s.hiddenElements.has(expressID)) return false;
  if (s.isolated !== null && s.isolated !== expressID) return false;
  return true;
}
```

- [ ] **Step 4: Failing test** `interaction/__tests__/section.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { sectionToPlane } from '../section';

describe('sectionToPlane', () => {
  it('returns null when disabled', () =>
    expect(sectionToPlane({ enabled: false, axis: 'Y', constant: 0 })).toBeNull());
  it('builds a Y plane that keeps the region below the cut', () => {
    const plane = sectionToPlane({ enabled: true, axis: 'Y', constant: 2 })!;
    expect(plane).toBeInstanceOf(THREE.Plane);
    // a point below the cut is kept (signed distance > 0), above is clipped (< 0)
    expect(plane.distanceToPoint(new THREE.Vector3(0, 1, 0))).toBeGreaterThan(0);
    expect(plane.distanceToPoint(new THREE.Vector3(0, 3, 0))).toBeLessThan(0);
  });
});
```

- [ ] **Step 5: Run → FAIL**, then implement `interaction/section.ts`:

```typescript
import * as THREE from 'three';
import type { SectionState } from '../../stores/viewport-store';

const NORMALS: Record<SectionState['axis'], THREE.Vector3> = {
  X: new THREE.Vector3(-1, 0, 0),
  Y: new THREE.Vector3(0, -1, 0),
  Z: new THREE.Vector3(0, 0, -1),
};

/** A THREE clipping plane that keeps the region on the negative side of the axis (i.e. cuts off the positive side at `constant`). */
export function sectionToPlane(s: SectionState): THREE.Plane | null {
  if (!s.enabled) return null;
  const normal = NORMALS[s.axis].clone();
  // keep points p where normal·p + d > 0  ⟹  for Y: -y + constant > 0 ⟹ y < constant
  return new THREE.Plane(normal, s.constant);
}
```

- [ ] **Step 6: Run → PASS.** Commit `feat(desktop): pure viewport derivations (isMeshVisible, sectionToPlane)`.

---

## Task 3: Load lifecycle — `loadBuilding`, cache, `useViewportLoader` (Vitest)

**Files:** Create `use-viewport-loader.ts`; modify `data/clients.ts`; test `viewport/__tests__/use-viewport-loader.spec.ts`.

- [ ] **Step 1: Expose the clients** — add to `data/clients.ts` (so the viewport hooks reach the REST + realtime clients built by `useBootstrap`):

```typescript
type Clients = Awaited<ReturnType<typeof buildClients>>;
let _clients: Clients | null = null;
export function setClients(c: Clients | null) { _clients = c; }
export function getClients(): Clients | null { return _clients; }
```
In `use-bootstrap.ts` `bootstrap()`, after building, call `setClients(clients)` (and `setClients(null)` on logout).

- [ ] **Step 2: Failing test** `viewport/__tests__/use-viewport-loader.spec.ts` (lifecycle branches against mocks):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { loadBuilding, createModelCache } from '../use-viewport-loader';

const fakeModel = (id = 'm') => ({ id, dispose: vi.fn() } as any);
const calls = () => { const c: any[] = []; return { c, push: (x: any) => c.push(x) }; };

const harness = (over: any = {}) => {
  const status: any[] = []; let model: any = null;
  return {
    status, get model() { return model; },
    opts: {
      propertyId: 'b1',
      isCurrent: () => true,
      setStatus: (s: string, e?: string) => status.push([s, e ?? null]),
      setModel: (m: any) => { model = m; },
      cache: createModelCache(),
      rest: {
        getBuildingModel: vi.fn().mockResolvedValue({ model: { id: 'bm' }, activeVersion: { id: 'v1' } }),
        getActiveModelFile: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      },
      loader: { loadModel: vi.fn().mockResolvedValue(fakeModel()) },
      ...over,
    },
  };
};

describe('loadBuilding', () => {
  it('happy path: loading → parsing → ready with a model', async () => {
    const h = harness();
    await loadBuilding(h.opts as any);
    expect(h.status.map((s) => s[0])).toEqual(['loading', 'parsing', 'ready']);
    expect(h.model).toBeTruthy();
  });

  it('MODEL_001 → empty (no download/parse)', async () => {
    const h = harness({ rest: {
      getBuildingModel: vi.fn().mockRejectedValue(Object.assign(new Error('none'), { code: 'MODEL_001' })),
      getActiveModelFile: vi.fn(),
    } });
    await loadBuilding(h.opts as any);
    expect(h.status.map((s) => s[0])).toEqual(['loading', 'empty']);
    expect(h.opts.rest.getActiveModelFile).not.toHaveBeenCalled();
  });

  it('parse failure → error, never throws', async () => {
    const h = harness({ loader: { loadModel: vi.fn().mockRejectedValue(new Error('bad ifc')) } });
    await expect(loadBuilding(h.opts as any)).resolves.toBeUndefined();
    expect(h.status.at(-1)![0]).toBe('error');
  });

  it('stale resolve is discarded and the model disposed', async () => {
    const m = fakeModel();
    const h = harness({ isCurrent: () => false, loader: { loadModel: vi.fn().mockResolvedValue(m) } });
    await loadBuilding(h.opts as any);
    expect(h.model).toBeNull();
    expect(m.dispose).toHaveBeenCalled();
  });

  it('cache hit restores instantly without re-downloading', async () => {
    const cache = createModelCache(); const m = fakeModel('cached'); cache.put('b1', m);
    const h = harness({ cache });
    await loadBuilding(h.opts as any);
    expect(h.model).toBe(m);
    expect(h.opts.rest.getBuildingModel).not.toHaveBeenCalled();
  });
});

describe('createModelCache (keep-last-1)', () => {
  it('evicts and disposes the previous entry', () => {
    const cache = createModelCache();
    const a = fakeModel('a'), b = fakeModel('b');
    cache.put('a', a); cache.put('b', b);     // putting b evicts a
    expect(a.dispose).toHaveBeenCalled();
    expect(cache.take('b')).toBe(b);
    expect(cache.take('a')).toBeNull();
  });
});
```

- [ ] **Step 3: Run → FAIL.** `cd apps/desktop && npm test -- use-viewport-loader`.

- [ ] **Step 4: Implement** `use-viewport-loader.ts`:

```typescript
import { useEffect, useRef } from 'react';
import type { ParsedModel, IfcModelLoader } from './ifc/ifc-types';
import { createIfcModelLoader } from './ifc/ifc-model-loader';
import { useViewportStore } from '../stores/viewport-store';
import { getClients } from '../data/clients';

interface RestLike {
  getBuildingModel(id: string): Promise<unknown>;
  getActiveModelFile(id: string): Promise<ArrayBuffer>;
}
export interface ModelCache {
  put(id: string, model: ParsedModel): void;
  take(id: string): ParsedModel | null;
  clear(id?: string): void;
}

export function createModelCache(): ModelCache {
  let entry: { id: string; model: ParsedModel } | null = null;
  return {
    put(id, model) {
      if (entry && entry.id !== id) entry.model.dispose();
      if (entry?.id === id && entry.model !== model) entry.model.dispose();
      entry = { id, model };
    },
    take(id) { if (entry?.id === id) { const m = entry.model; entry = null; return m; } return null; },
    clear(id) { if (!id || entry?.id === id) { entry?.model.dispose(); entry = null; } },
  };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Unexpected error');
const codeOf = (e: unknown) => (e as { code?: string })?.code;

export async function loadBuilding(opts: {
  propertyId: string;
  rest: RestLike;
  loader: IfcModelLoader;
  cache: ModelCache;
  isCurrent: () => boolean;
  setStatus: (s: string, error?: string | null) => void;
  setModel: (m: ParsedModel | null) => void;
}): Promise<void> {
  const { propertyId, rest, loader, cache, isCurrent, setStatus, setModel } = opts;
  setStatus('loading');

  const cached = cache.take(propertyId);
  if (cached) {
    if (!isCurrent()) { cache.put(propertyId, cached); return; }
    setModel(cached); setStatus('ready'); return;
  }
  try { await rest.getBuildingModel(propertyId); }
  catch (e) {
    if (!isCurrent()) return;
    if (codeOf(e) === 'MODEL_001') setStatus('empty'); else setStatus('error', errText(e));
    return;
  }
  if (!isCurrent()) return;

  let bytes: ArrayBuffer;
  try { bytes = await rest.getActiveModelFile(propertyId); }
  catch (e) { if (isCurrent()) setStatus('error', errText(e)); return; }
  if (!isCurrent()) return;

  setStatus('parsing');
  let model: ParsedModel;
  try { model = await loader.loadModel(bytes); }
  catch { if (isCurrent()) setStatus('error', "Couldn't open this model"); return; }
  if (!isCurrent()) { model.dispose(); return; }
  setModel(model); setStatus('ready');
}

/** Wires loadBuilding to the active building + reloadNonce, stashing the prior model in a keep-last-1 cache. */
export function useViewportLoader(loader: IfcModelLoader = createIfcModelLoader()) {
  const cacheRef = useRef<ModelCache>();
  cacheRef.current ??= createModelCache();
  const shownRef = useRef<{ id: string; model: ParsedModel } | null>(null);
  const propertyId = useViewportStore((s) => s.activeBuildingPropertyId);
  const nonce = useViewportStore((s) => s.reloadNonce);

  useEffect(() => {
    const store = useViewportStore.getState();
    // stash whatever is currently shown so toggling back is instant
    if (shownRef.current) { cacheRef.current!.put(shownRef.current.id, shownRef.current.model); shownRef.current = null; }
    store._setModel(null);
    if (!propertyId) { store._setStatus('idle'); return; }

    let active = true;
    const rest = getClients()?.rest as unknown as RestLike;
    if (!rest) { store._setStatus('error', 'Not connected'); return; }

    loadBuilding({
      propertyId, rest, loader, cache: cacheRef.current!,
      isCurrent: () => active && useViewportStore.getState().activeBuildingPropertyId === propertyId,
      setStatus: (s, e) => store._setStatus(s as any, e),
      setModel: (m) => { store._setModel(m); if (m) shownRef.current = { id: propertyId, model: m }; },
    });
    return () => { active = false; };
  }, [propertyId, nonce, loader]);
}
```

- [ ] **Step 5: Run → PASS.** Commit `feat(desktop): viewport load lifecycle (race-safe, keep-last-1 cache)`.

---

## Task 4: State overlays, ViewportHost wiring & realtime banner (RTL)

**Files:** Create `ui/overlays/{Idle,Loading,Empty,ErrorState,UpdateBanner}.tsx`, `use-model-realtime.ts`; modify `shell/ViewportHost.tsx`; tests `viewport/ui/__tests__/overlays.spec.tsx`, `viewport/__tests__/use-model-realtime.spec.ts`.

- [ ] **Step 1: Overlays** (presentational; `ui/overlays/*.tsx`). Each is a labelled `<div role="status">`:

```tsx
export const Idle = () => <div role="status">Select a building to view its model.</div>;
export const Loading = ({ parsing = false }: { parsing?: boolean }) =>
  <div role="status">{parsing ? 'Opening model…' : 'Downloading model…'}</div>;
export const Empty = () => <div role="status">No 3D model has been uploaded for this building yet.</div>;
export const ErrorState = ({ message, onRetry }: { message: string; onRetry: () => void }) =>
  <div role="alert">{message} <button onClick={onRetry}>Retry</button></div>;
export const UpdateBanner = ({ onReload }: { onReload: () => void }) =>
  <div role="status">Model updated <button onClick={onReload}>Reload</button></div>;
```

- [ ] **Step 2: Failing test** `viewport/ui/__tests__/overlays.spec.tsx` — ViewportHost renders the overlay for each status, and the ready slot otherwise:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ViewportHost } from '../../../shell/ViewportHost';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';

// presentation-only: stub the side-effectful hooks so they don't drive status
vi.mock('../../use-viewport-loader', () => ({ useViewportLoader: () => {} }));
vi.mock('../../use-model-realtime', () => ({ useModelRealtime: () => {} }));

beforeEach(() => useViewportStore.setState(initialViewportState(), true));

describe('ViewportHost states', () => {
  it('idle prompts to select a building', () => {
    render(<ViewportHost />);
    expect(screen.getByText(/select a building/i)).toBeInTheDocument();
  });
  it('empty explains there is no model', () => {
    useViewportStore.setState({ activeBuildingPropertyId: 'b', status: 'empty' });
    render(<ViewportHost />);
    expect(screen.getByText(/no 3d model/i)).toBeInTheDocument();
  });
  it('error shows the message and Retry triggers reload', () => {
    useViewportStore.setState({ activeBuildingPropertyId: 'b', status: 'error', error: 'boom' });
    render(<ViewportHost />);
    expect(screen.getByText(/boom/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry'));
    expect(useViewportStore.getState().reloadNonce).toBe(1);
  });
  it('updateAvailable shows the reload banner over the ready slot', () => {
    useViewportStore.setState({ activeBuildingPropertyId: 'b', status: 'ready', updateAvailable: true });
    render(<ViewportHost />);
    fireEvent.click(screen.getByText('Reload'));
    expect(useViewportStore.getState().updateAvailable).toBe(false);
  });
});
```

- [ ] **Step 3: Run → FAIL**, then **implement `shell/ViewportHost.tsx`** (replaces Spec 2's placeholder body; the `ready` slot is a stand-in Phase C swaps for the canvas):

```tsx
import { useViewportStore } from '../stores/viewport-store';
import { useViewportLoader } from '../viewport/use-viewport-loader';
import { useModelRealtime } from '../viewport/use-model-realtime';
import { Idle, Loading, Empty, ErrorState, UpdateBanner } from '../viewport/ui/overlays';

export function ViewportHost() {
  useViewportLoader();
  useModelRealtime();
  const { status, error, model, updateAvailable, reload } = useViewportStore();

  return (
    <main aria-label="viewport" style={{ position: 'relative', flex: 1 }}>
      {status === 'idle' && <Idle />}
      {status === 'loading' && <Loading />}
      {status === 'parsing' && <Loading parsing />}
      {status === 'empty' && <Empty />}
      {status === 'error' && <ErrorState message={error ?? 'Error'} onRetry={reload} />}
      {status === 'ready' && (
        <>
          {/* Phase C replaces this slot with <ViewportCanvas model={model} /> */}
          <div role="status">Model ready — {model?.elementIndex.size ?? 0} elements</div>
          {updateAvailable && <UpdateBanner onReload={reload} />}
        </>
      )}
    </main>
  );
}
```
Add a barrel `ui/overlays/index.ts` re-exporting the five overlays.

- [ ] **Step 4: Realtime hook** `use-model-realtime.ts` — flag updates for the open building, revert to empty on delete:

```typescript
import { useEffect } from 'react';
import { WS_EVENTS } from '@nodescope/shared';
import { useViewportStore } from '../stores/viewport-store';
import { getClients } from '../data/clients';

export function useModelRealtime() {
  const propertyId = useViewportStore((s) => s.activeBuildingPropertyId);
  useEffect(() => {
    const rt = getClients()?.realtime;
    if (!rt || !propertyId) return;
    const isMine = (p: { propertyId?: string }) => p?.propertyId === propertyId;
    const onChange = (p: any) => { if (isMine(p)) useViewportStore.getState().flagUpdate(); };
    const onDelete = (p: any) => { if (isMine(p)) useViewportStore.getState()._setStatus('empty'); };
    rt.on(WS_EVENTS.BUILDING_MODEL_ACTIVATED, onChange);
    rt.on(WS_EVENTS.BUILDING_MODEL_VERSION_UPLOADED, onChange);
    rt.on(WS_EVENTS.BUILDING_MODEL_DELETED, onDelete);
    return () => { rt.off?.(WS_EVENTS.BUILDING_MODEL_ACTIVATED, onChange);
                   rt.off?.(WS_EVENTS.BUILDING_MODEL_VERSION_UPLOADED, onChange);
                   rt.off?.(WS_EVENTS.BUILDING_MODEL_DELETED, onDelete); };
  }, [propertyId]);
}
```
Add a focused test `use-model-realtime.spec.ts`: with a fake realtime client (records handlers), emitting `activated` for the active building sets `updateAvailable`; for a different building does nothing; `deleted` sets status `empty`.

- [ ] **Step 5: Run → PASS** (overlays + realtime). Commit `feat(desktop): viewport state overlays + realtime model-updated banner`.

---

## Task 5: Phase gate

- [ ] **Step 1: Suite.** `cd apps/desktop && npm test -- viewport stores` → green (store, derivations, lifecycle, overlays, realtime).
- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` → PASS.
- [ ] **Step 3: Manual smoke (optional, needs a running API + a building with a model):** launch `electron-vite dev`, select that building → status walks loading → parsing → ready ("Model ready — N elements"); select a building with no model → "No 3D model…"; kill the API mid-load → error + Retry.
- [ ] **Step 4: Docs (Rule 10).** Note in `apps/desktop/README.md` the viewport state machine (`idle/loading/parsing/ready/empty/error`), keep-last-1 caching, and that `data/clients.ts` now exposes the built clients to the viewport hooks.
- [ ] **Step 5: Commit** `docs: record Spec 3 viewport store + lifecycle + states (Phase B)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** extended `viewportStore` (§4, §11) ✓ Task 1; `isMeshVisible` derivation (§8) ✓ Task 2; section state→plane (§8) ✓ Task 2; load lifecycle metadata→download→parse→ready (§9) ✓ Task 3; `MODEL_001`→empty (§9) ✓ Task 3; race-safety on stale resolve (§9) ✓ Task 3; keep-last-1 cache + dispose-on-evict (§9) ✓ Task 3; idle/loading/parsing/empty/error overlays (§9) ✓ Task 4; "model updated" banner + revert-to-empty on delete (§9 realtime) ✓ Task 4; per-building state reset (§9 switch) ✓ Task 1.
- **Deferred (correctly NOT here):** the r3f canvas/camera/render of `model.root` (Phase C); raycast picking, the Inspector, applying `isMeshVisible`/highlight/`sectionToPlane` to actual meshes, the Toolbar (Phase D). The `ready` slot is an explicit placeholder Phase C replaces (stated).
- **Placeholder scan:** none — complete code/commands. The `ready` stand-in `<div>` is a stated phase boundary, not a TODO.
- **Type consistency:** store `ViewportStatus`/`SectionState`/`ViewportState` + `initialViewportState` are consumed by `loadBuilding` (`setStatus`/`setModel`), `ViewportHost`, `useModelRealtime`, and Phase C/D. `isMeshVisible(mesh, VisibilityState)` and `sectionToPlane(SectionState)` are Phase D's exact imports. `ModelCache` (`put`/`take`/`clear`) matches between `createModelCache` and `useViewportLoader`. `getClients()/setClients()` added to Spec 2's `data/clients.ts`. `model.elementIndex` / `ParsedModel` from Phase A.
- **Test-config compliance:** store + derivation + lifecycle specs are environment-agnostic; overlay/realtime specs use jsdom + RTL (Spec 2's `vitest.config.ts`). Mocks stand in for the REST/realtime clients and the loader — no network, no WebGL.
- **Integration points to verify during execution:** the exact `ApiError.code` field name from `@nodescope/client` (assumed `code='MODEL_001'`); `WS_EVENTS.BUILDING_MODEL_*` keys from `@nodescope/shared`; the realtime client's `off`/unsubscribe API; that `getActiveModelFile` resolves an `ArrayBuffer` (download progress is indeterminate unless the client adds an `onProgress` — a later refinement, spec §9).
