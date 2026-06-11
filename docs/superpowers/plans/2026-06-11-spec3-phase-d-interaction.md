# Spec 3 Phase D — Interaction (Pick / Inspect / Visibility / Section) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the rendered model interactive — raycast picking → selection + highlight; a docked Inspector showing the picked element's IFC type/name/property sets with isolate/hide/zoom actions; category visibility + isolate/hide applied to the meshes; and a single section (clip) plane. This completes the Spec 3 viewer.

**Architecture:** A pure `pickExpressId` raycasts the visible meshes; `applyModelState` (pure over three objects) reflects the store's visibility/selection/section onto `model.elementIndex` (mesh `.visible`, emissive highlight, `material.clippingPlanes`); `<ModelView>` runs it in a store-subscribed effect + `invalidate()`. DOM overlays (`Toolbar`, `Inspector`) read/write the store; camera commands (fit / zoom-to-selection) cross the DOM↔r3f boundary via store nonces consumed by an in-Canvas `<ViewCommands>` — the same Zustand bridge Spec 2 chose.

**Tech Stack:** React 19 DOM, `@react-three/fiber`, `three`, Vitest + React Testing Library + `@react-three/test-renderer`.

**Depends on:**
- **Phase A** — `ParsedModel` (`elementIndex`, `categories`, `bbox`, `getProperties`), `mesh.userData.{expressID,ifcType}`.
- **Phase B** — the store (`selection`/`hiddenCategories`/`isolated`/`hiddenElements`/`section` + actions), `isMeshVisible`, `sectionToPlane`.
- **Phase C** — `ViewportCanvas` / `ModelView` / `CameraRig` / `fitCameraToBox`.
- Spec: `docs/superpowers/specs/2026-06-11-spec3-3d-viewport-design.md` (§7, §8, §11).

> This is the last Spec 3 phase. It ends with the cross-plan self-review over Phases A–D.

---

## File Structure

**Create:**
- `apps/desktop/src/renderer/viewport/interaction/picking.ts` — pure `pickExpressId` + `<PickingController>`
- `apps/desktop/src/renderer/viewport/scene/apply-model-state.ts` — pure `applyModelState`
- `apps/desktop/src/renderer/viewport/scene/ViewCommands.tsx` — in-Canvas fit/focus consumer
- `apps/desktop/src/renderer/viewport/ui/Inspector.tsx`
- `apps/desktop/src/renderer/viewport/ui/Toolbar.tsx`
- tests under `viewport/**/__tests__/*`

**Modify:**
- `apps/desktop/src/renderer/stores/viewport-store.ts` — additive: `fitNonce`/`focusNonce` + `requestFit`/`requestFocus`
- `apps/desktop/src/renderer/viewport/scene/ModelView.tsx` — apply state in an effect
- `apps/desktop/src/renderer/viewport/scene/ViewportCanvas.tsx` — mount `<PickingController>` + `<ViewCommands>`
- `apps/desktop/src/renderer/shell/ViewportHost.tsx` — add `<Toolbar>` + `<Inspector>` overlays to the `ready` slot

---

## Task 1: Picking — `pickExpressId` + controller (Vitest)

**Files:** Create `interaction/picking.ts`; test `interaction/__tests__/picking.spec.ts`.

- [ ] **Step 1: Failing test** `interaction/__tests__/picking.spec.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { pickExpressId } from '../picking';

function modelWith(mesh: THREE.Mesh) {
  return { elementIndex: new Map([[mesh.userData.expressID as number, mesh]]) } as any;
}
const vis = { hiddenCategories: new Set<string>(), hiddenElements: new Set<number>(), isolated: null as number | null };

describe('pickExpressId', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  mesh.userData = { expressID: 7, ifcType: 'IFCWALL' };
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100); cam.position.set(0, 0, 10); cam.lookAt(0, 0, 0);
  const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0, 0), cam);

  it('returns the expressID of the mesh under the ray', () => {
    expect(pickExpressId(ray, modelWith(mesh), vis)).toBe(7);
  });
  it('skips hidden meshes', () => {
    expect(pickExpressId(ray, modelWith(mesh), { ...vis, hiddenElements: new Set([7]) })).toBeNull();
  });
  it('returns null when the ray misses', () => {
    const miss = new THREE.Raycaster(); miss.setFromCamera(new THREE.Vector2(0.99, 0.99), cam);
    expect(pickExpressId(miss, modelWith(mesh), vis)).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `interaction/picking.ts`:

```typescript
import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { ParsedModel, ExpressId } from '../ifc/ifc-types';
import { isMeshVisible, type VisibilityState } from './visibility';
import { useViewportStore } from '../../stores/viewport-store';

export function pickExpressId(ray: THREE.Raycaster, model: ParsedModel, vis: VisibilityState): ExpressId | null {
  const meshes = [...model.elementIndex.values()].filter((m) => isMeshVisible(m, vis));
  const hits = ray.intersectObjects(meshes, false);
  return hits.length ? ((hits[0].object.userData.expressID as ExpressId) ?? null) : null;
}

/** Mounts inside <Canvas>: pointer-down → raycast visible meshes → store.select. */
export function PickingController({ model }: { model: ParsedModel }) {
  const { gl, camera, raycaster } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const onDown = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const s = useViewportStore.getState();
      const id = pickExpressId(raycaster, model, { hiddenCategories: s.hiddenCategories, hiddenElements: s.hiddenElements, isolated: s.isolated });
      s.select(id);
    };
    el.addEventListener('pointerdown', onDown);
    return () => el.removeEventListener('pointerdown', onDown);
  }, [gl, camera, raycaster, model]);
  return null;
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(desktop): viewport raycast picking → selection`.

---

## Task 2: Apply visibility / highlight / section — `applyModelState` + ModelView (Vitest)

**Files:** Create `scene/apply-model-state.ts`; modify `scene/ModelView.tsx`; test `scene/__tests__/apply-model-state.spec.ts`.

- [ ] **Step 1: Failing test** `scene/__tests__/apply-model-state.spec.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyModelState } from '../apply-model-state';
import type { ParsedModel } from '../../ifc/ifc-types';

function model(): ParsedModel {
  const mk = (id: number, t: string) => { const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial()); m.userData = { expressID: id, ifcType: t }; return m; };
  const a = mk(1, 'IFCWALL'), b = mk(2, 'IFCSLAB');
  const root = new THREE.Group(); root.add(a, b);
  return { root, categories: new Map(), elementIndex: new Map([[1, a], [2, b]]), bbox: new THREE.Box3(),
    frame: { recenter: new THREE.Vector3(), upConversion: 'Z_UP_TO_Y_UP' }, getProperties: async () => ({} as any), dispose: () => {} };
}
const base = { selection: null as number | null, hiddenCategories: new Set<string>(), hiddenElements: new Set<number>(), isolated: null as number | null, section: { enabled: false, axis: 'Y' as const, constant: 0 } };

describe('applyModelState', () => {
  it('hides a category', () => {
    const m = model(); applyModelState(m, { ...base, hiddenCategories: new Set(['IFCSLAB']) });
    expect(m.elementIndex.get(1)!.visible).toBe(true);
    expect(m.elementIndex.get(2)!.visible).toBe(false);
  });
  it('highlights only the selected element (emissive)', () => {
    const m = model(); applyModelState(m, { ...base, selection: 1 });
    expect((m.elementIndex.get(1)!.material as THREE.MeshLambertMaterial).emissive.getHex()).not.toBe(0x000000);
    expect((m.elementIndex.get(2)!.material as THREE.MeshLambertMaterial).emissive.getHex()).toBe(0x000000);
  });
  it('attaches a clipping plane when the section is enabled', () => {
    const m = model(); applyModelState(m, { ...base, section: { enabled: true, axis: 'Y', constant: 1 } });
    expect((m.elementIndex.get(1)!.material as THREE.Material).clippingPlanes).toHaveLength(1);
    applyModelState(m, base);
    expect((m.elementIndex.get(1)!.material as THREE.Material).clippingPlanes).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `scene/apply-model-state.ts`:

```typescript
import * as THREE from 'three';
import type { ParsedModel, ExpressId, IfcType } from '../ifc/ifc-types';
import { isMeshVisible } from '../interaction/visibility';
import { sectionToPlane } from '../interaction/section';
import type { SectionState } from '../../stores/viewport-store';

const HIGHLIGHT = 0x3366ff;

export interface ModelViewState {
  selection: ExpressId | null;
  hiddenCategories: Set<IfcType>;
  hiddenElements: Set<ExpressId>;
  isolated: ExpressId | null;
  section: SectionState;
}

export function applyModelState(model: ParsedModel, s: ModelViewState): void {
  const plane = sectionToPlane(s.section);
  const planes = plane ? [plane] : null;
  for (const [id, mesh] of model.elementIndex) {
    mesh.visible = isMeshVisible(mesh, s);
    const mat = mesh.material as THREE.MeshLambertMaterial;
    mat.emissive.setHex(id === s.selection ? HIGHLIGHT : 0x000000);
    mat.clippingPlanes = planes;
    mat.needsUpdate = true;
  }
}
```

- [ ] **Step 3: Extend `scene/ModelView.tsx`** to apply state on every relevant store change + invalidate:

```tsx
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type { ParsedModel } from '../ifc/ifc-types';
import { useViewportStore } from '../../stores/viewport-store';
import { applyModelState } from './apply-model-state';

export function ModelView({ model }: { model: ParsedModel }) {
  const { invalidate } = useThree();
  const selection = useViewportStore((s) => s.selection);
  const hiddenCategories = useViewportStore((s) => s.hiddenCategories);
  const hiddenElements = useViewportStore((s) => s.hiddenElements);
  const isolated = useViewportStore((s) => s.isolated);
  const section = useViewportStore((s) => s.section);
  useEffect(() => {
    applyModelState(model, { selection, hiddenCategories, hiddenElements, isolated, section });
    invalidate();
  }, [model, selection, hiddenCategories, hiddenElements, isolated, section, invalidate]);
  return <primitive object={model.root} />;
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(desktop): apply visibility/highlight/section to the model`.

---

## Task 3: View commands — store nonces + in-Canvas consumer (Vitest)

**Files:** Modify `stores/viewport-store.ts` (additive); create `scene/ViewCommands.tsx`; modify `scene/ViewportCanvas.tsx`; extend the store test.

- [ ] **Step 1: Additive store fields** — add to `ViewportState`, `initialViewportState`, and the actions:

```typescript
// ViewportState: add
  fitNonce: number;
  focusNonce: number;
  requestFit: () => void;
  requestFocus: () => void;
// initialViewportState: add  fitNonce: 0, focusNonce: 0,
// actions: add
  requestFit: () => set((s) => ({ fitNonce: s.fitNonce + 1 })),
  requestFocus: () => set((s) => ({ focusNonce: s.focusNonce + 1 })),
```
Add a store test: `requestFit()` / `requestFocus()` bump their nonces.

- [ ] **Step 2: `scene/ViewCommands.tsx`** — frame on fit, frame the selection on focus:

```tsx
import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { ParsedModel } from '../ifc/ifc-types';
import { useViewportStore } from '../../stores/viewport-store';
import { fitCameraToBox } from './fit';

export function ViewCommands({ model, controls }: { model: ParsedModel; controls: React.RefObject<OrbitControlsImpl> }) {
  const { camera, size, invalidate } = useThree();
  const fitNonce = useViewportStore((s) => s.fitNonce);
  const focusNonce = useViewportStore((s) => s.focusNonce);

  const frame = (box: THREE.Box3) => {
    const { position, target } = fitCameraToBox(box, (camera as THREE.PerspectiveCamera).fov, size.width / size.height);
    camera.position.copy(position); camera.lookAt(target);
    if (controls.current) { controls.current.target.copy(target); controls.current.update(); }
    invalidate();
  };
  useEffect(() => { if (fitNonce) frame(model.bbox); }, [fitNonce]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focusNonce) return;
    const id = useViewportStore.getState().selection;
    const mesh = id != null ? model.elementIndex.get(id) : null;
    if (mesh) frame(new THREE.Box3().setFromObject(mesh));
  }, [focusNonce]);   // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
```

- [ ] **Step 3: Mount in `ViewportCanvas.tsx`** — add `<PickingController model={model} />` and `<ViewCommands model={model} controls={controls} />` inside the `<Canvas>` (after `<ModelView>`). Imports added.

- [ ] **Step 4: Run → PASS** (store nonces). Commit `feat(desktop): viewport fit/zoom-to-selection commands`.

---

## Task 4: Inspector (Vitest + RTL)

**Files:** Create `ui/Inspector.tsx`; test `viewport/ui/__tests__/inspector.spec.tsx`.

- [ ] **Step 1: Failing test** `viewport/ui/__tests__/inspector.spec.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Inspector } from '../Inspector';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';

beforeEach(() => useViewportStore.setState(initialViewportState(), true));

function modelWithProps() {
  return {
    elementIndex: new Map([[5, {}]]),
    getProperties: vi.fn().mockResolvedValue({ expressID: 5, ifcType: 'IFCWALL', name: 'Wall-1', tag: 'W1',
      propertySets: [{ name: 'Pset_WallCommon', props: [{ name: 'IsExternal', value: 'true' }] }] }),
  } as any;
}

describe('Inspector', () => {
  it('renders nothing without a selection', () => {
    useViewportStore.setState({ model: modelWithProps(), selection: null });
    const { container } = render(<Inspector />);
    expect(container).toBeEmptyDOMElement();
  });
  it('shows the selected element properties and acts on it', async () => {
    const model = modelWithProps();
    useViewportStore.setState({ model, selection: 5 });
    render(<Inspector />);
    await waitFor(() => expect(screen.getByText('Wall-1')).toBeInTheDocument());
    expect(screen.getByText('IsExternal')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Isolate'));
    expect(useViewportStore.getState().isolated).toBe(5);
    fireEvent.click(screen.getByText('Hide'));
    expect(useViewportStore.getState().hiddenElements.has(5)).toBe(true);
    fireEvent.click(screen.getByText('Zoom to'));
    expect(useViewportStore.getState().focusNonce).toBe(1);
  });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `ui/Inspector.tsx` (docked right, collapsible):

```tsx
import { useEffect, useState } from 'react';
import { useViewportStore } from '../../stores/viewport-store';
import type { ElementProperties } from '../ifc/ifc-types';

export function Inspector() {
  const { model, selection, isolate, hideElement, requestFocus } = useViewportStore();
  const [props, setProps] = useState<ElementProperties | null>(null);

  useEffect(() => {
    let live = true;
    if (model && selection != null) model.getProperties(selection).then((p) => { if (live) setProps(p); });
    else setProps(null);
    return () => { live = false; };
  }, [model, selection]);

  if (selection == null || !props) return null;
  return (
    <aside aria-label="inspector" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 300, overflow: 'auto' }}>
      <h3>{props.name ?? props.ifcType}</h3>
      <dl>
        <dt>Type</dt><dd>{props.ifcType}</dd>
        {props.tag && (<><dt>Tag</dt><dd>{props.tag}</dd></>)}
      </dl>
      <div>
        <button onClick={() => isolate(selection)}>Isolate</button>
        <button onClick={() => hideElement(selection)}>Hide</button>
        <button onClick={() => requestFocus()}>Zoom to</button>
      </div>
      {props.propertySets.map((ps) => (
        <section key={ps.name}>
          <h4>{ps.name}</h4>
          <dl>{ps.props.map((p) => (<><dt key={p.name}>{p.name}</dt><dd>{p.value}</dd></>))}</dl>
        </section>
      ))}
    </aside>
  );
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(desktop): viewport Inspector (element properties + isolate/hide/zoom)`.

---

## Task 5: Toolbar (Vitest + RTL)

**Files:** Create `ui/Toolbar.tsx`; test `viewport/ui/__tests__/toolbar.spec.tsx`.

- [ ] **Step 1: Failing test** `viewport/ui/__tests__/toolbar.spec.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toolbar } from '../Toolbar';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';

function model() {
  const wall = new THREE.Group(); wall.add(new THREE.Mesh(), new THREE.Mesh());
  return { categories: new Map([['IFCWALL', wall]]) } as any;
}
beforeEach(() => useViewportStore.setState({ ...initialViewportState(), model: model() }, true));

describe('Toolbar', () => {
  it('Fit requests a fit', () => { render(<Toolbar />); fireEvent.click(screen.getByText('Fit')); expect(useViewportStore.getState().fitNonce).toBe(1); });
  it('Show all clears hidden state', () => {
    useViewportStore.setState({ isolated: 3 }); render(<Toolbar />);
    fireEvent.click(screen.getByText('Show all')); expect(useViewportStore.getState().isolated).toBeNull();
  });
  it('toggles the section plane', () => {
    render(<Toolbar />); fireEvent.click(screen.getByLabelText('Section')); expect(useViewportStore.getState().section.enabled).toBe(true);
  });
  it('lists categories with counts and toggles visibility', () => {
    render(<Toolbar />);
    expect(screen.getByText(/IFCWALL \(2\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('toggle IFCWALL'));
    expect(useViewportStore.getState().hiddenCategories.has('IFCWALL')).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `ui/Toolbar.tsx`:

```tsx
import { useViewportStore } from '../../stores/viewport-store';

export function Toolbar() {
  const { model, section, hiddenCategories, requestFit, showAll, setSection, toggleCategory } = useViewportStore();
  const cats = model ? [...model.categories.entries()] : [];
  return (
    <div aria-label="viewport-toolbar" style={{ position: 'absolute', top: 0, left: 0, right: 300, display: 'flex', gap: 8 }}>
      <button onClick={() => requestFit()}>Fit</button>
      <button onClick={() => showAll()}>Show all</button>
      <label><input aria-label="Section" type="checkbox" checked={section.enabled} onChange={(e) => setSection({ enabled: e.target.checked })} /> Section</label>
      {section.enabled && (
        <>
          <select aria-label="Section axis" value={section.axis} onChange={(e) => setSection({ axis: e.target.value as any })}>
            <option>X</option><option>Y</option><option>Z</option>
          </select>
          <input aria-label="Section position" type="range" min={-50} max={50} step={0.1}
                 value={section.constant} onChange={(e) => setSection({ constant: Number(e.target.value) })} />
        </>
      )}
      <details>
        <summary>Categories</summary>
        {cats.map(([type, group]) => (
          <label key={type} style={{ display: 'block' }}>
            <input aria-label={`toggle ${type}`} type="checkbox" checked={!hiddenCategories.has(type)} onChange={() => toggleCategory(type)} />
            {type} ({group.children.length})
          </label>
        ))}
      </details>
    </div>
  );
}
```

- [ ] **Step 3: Mount overlays in `ViewportHost.tsx`** — in the `ready` slot, add `<Toolbar />` and `<Inspector />` above the canvas:

```tsx
{status === 'ready' && model && (
  <>
    <ViewportCanvas model={model} />
    <Toolbar />
    <Inspector />
    {updateAvailable && <UpdateBanner onReload={reload} />}
  </>
)}
```
Add the imports. (The Section position `min/max` is a fixed ±50 m for v1; deriving the slider range from `model.bbox` per-axis is a polish item, spec §8.)

- [ ] **Step 4: Run → PASS.** Commit `feat(desktop): viewport Toolbar (fit/section/show-all/category visibility)`.

---

## Task 6: Phase gate

- [ ] **Step 1: Full Spec 3 suite.** `cd apps/desktop && npm test -- viewport stores` → green across all four phases.
- [ ] **Step 2: Typecheck + lint.** `npx tsc --noEmit` → PASS; `npm run lint` clean.
- [ ] **Step 3: Manual end-to-end (needs a building with a model + running API):** `electron-vite dev` → select the building → orbit; click a wall → it highlights + the Inspector shows its psets; Isolate → only it shows; Show all → restored; toggle a category off → those elements vanish; enable Section + drag the slider → the model cuts; Fit re-frames; Zoom-to frames the selection. (Visual correctness is manual, spec §13.)
- [ ] **Step 4: Docs (Rule 10).** `apps/desktop/README.md`: picking/inspect/isolate/hide-by-category/section; the DOM↔r3f store-nonce bridge for camera commands; update the SAD/CLAUDE.md that the desktop renders 3D (r3f + web-ifc) and that `viewportStore` + `ParsedModel` (with its recenter+Y-up `frame`) are the Spec 4 contract.
- [ ] **Step 5: Commit** `docs: record Spec 3 interaction layer (Phase D) + viewer complete`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** raycast pick → select (§7) ✓ Task 1; emissive highlight of the selection (§7) ✓ Task 2; Inspector type/name/tag + property sets, docked right (§7) ✓ Task 4; isolate / hide / zoom-to actions (§7) ✓ Tasks 3–4; category visibility menu with counts (§8) ✓ Task 5; isolate/hide applied to meshes via `isMeshVisible` (§8) ✓ Task 2; single section plane + axis + position (§8) ✓ Tasks 2, 5; fit + zoom-to-selection (§6 navigation) ✓ Task 3.
- **Deferred (correctly per spec):** by-storey category grouping, outline highlight, per-axis slider range, multi-plane sectioning, non-active versions (§3, §15); Worker offload + geometry batching (§10).
- **Placeholder scan:** none — complete code/commands throughout.
- **Type consistency:** `pickExpressId(Raycaster, ParsedModel, VisibilityState)`; `applyModelState(ParsedModel, ModelViewState)` reuses Phase B's `isMeshVisible`/`sectionToPlane`; `ViewCommands`/`Inspector`/`Toolbar` use store actions (`select`/`isolate`/`hideElement`/`showAll`/`toggleCategory`/`setSection`/`requestFit`/`requestFocus`); the additive `fitNonce`/`focusNonce` extend Phase B's store; `model.categories`/`elementIndex`/`getProperties` from Phase A.
- **Test-config compliance:** pure pieces (`pickExpressId`, `applyModelState`) run node; `Inspector`/`Toolbar` use jsdom + RTL; store nonces are environment-agnostic. No GPU assertions (§13 manual).
- **Integration points to verify during execution:** r3f's shared `raycaster` from `useThree` vs a fresh one; `mesh.material` is per-element (Phase A) so emissive/clip edits don't bleed across elements; `material.needsUpdate` after toggling `clippingPlanes`; pointer-vs-orbit interaction (a drag that orbits shouldn't also select — debounce/threshold is a polish item).

---

# Spec 3 — cross-plan self-review (all four phases)

- **Spec coverage (full):** §4 architecture (r3f Canvas in `<ViewportHost>`, plain-three model, demand loop, Zustand bridge) → B (store/host) + C (canvas) ✓ · §5 `IfcModelLoader`/`ParsedModel`/`getProperties`/`dispose` → A ✓ · §6 scene/camera/controls/lighting → C ✓ · §7 pick/highlight/Inspector → D ✓ · §8 visibility/isolate/category/section → B (state+derivations) + D (application+UI) ✓ · §9 lifecycle/states/realtime/cache → B ✓ · §10 deferred-perf (Worker/batching behind the `IfcModelLoader` + `expressID` interfaces) → noted in A/D ✓ · §11 public interface (`viewportStore` + `ParsedModel` + `frame`) → A defines, B extends, exported for Spec 4 ✓ · §12 security (sandbox, untrusted-IFC caught, bundled WASM) → A (parse/catch) + B (error state) ✓ · §13 testing (node logic + jsdom/RTL + headless r3f; GPU manual) → every phase ✓.
- **Build-green order:** A (headless loader) → B (store/lifecycle/states, mocked) → C (render + navigate) → D (interact). Each phase ends green and independently testable; nothing in a later phase is imported by an earlier one.
- **Cross-phase type consistency:** `ParsedModel`/`ElementProperties`/`IfcType`/`ExpressId` (A) are consumed unchanged by B/C/D; `mesh.userData = { expressID, ifcType }` (A) is the picking/visibility key (B `isMeshVisible`, D `pickExpressId`/`applyModelState`); the store grows additively A-agnostic→B(full state)→D(`fitNonce`/`focusNonce`) with `initialViewportState` kept in sync; `fitCameraToBox` (C) is reused by `ViewCommands` (D); `ViewportHost`'s `ready` slot evolves placeholder(B)→canvas(C)→canvas+toolbar+inspector(D) with the stated test-assertion updates.
- **Flagged for execution:** the pinned `web-ifc` API surface + `.wasm` name (A); `@nodescope/client` `ApiError.code` + `getActiveModelFile` shape + `WS_EVENTS` keys (B); `@react-three/fiber`↔`three` peer versions + drei demand-invalidation (C); orbit-drag vs click-select disambiguation (D). All are localized and interface-stable.
- **Boundary to Spec 4:** Spec 4 consumes only §11 — the extended `viewportStore`, the `ParsedModel` handle, and the recenter + Z-up→Y-up `frame` — to place/pick device nodes in the same space. No Spec 3 internal is part of that contract.
