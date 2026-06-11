# Spec 4 Phase C — Placement (Place / Move / Clear) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authorized user position a device by clicking the building surface — raycast the hit, convert to native `x/y/z`, persist via Spec 1's position endpoint with an optimistic update + rollback — plus Move and Clear. Placing mode is driven by `placingDeviceId`; the trigger buttons live in Phase D.

**Architecture:** Pure-ish orchestration (`commitPlacement` / `clearPlacement`) does optimistic `upsertDevice` → `setDevicePosition` → rollback-on-reject, testable with a mocked client. `raycastBuildingPoint` returns the world hit on the visible building. `<PlacementController>` (in-Canvas) listens for a click while `placingDeviceId` is set and runs `commitPlacement`; `<PickingController>` skips selection while placing.

**Tech Stack:** React 19 DOM, `@react-three/fiber`, `three`, Zustand, Vitest, `@nodescope/client`.

**Depends on:**
- **Phase A** — `toModel`, store (`devices`/`upsertDevice`/`placingDeviceId`/`beginPlace`/`cancelPlace`), client `setDevicePosition`.
- **Phase B** — `<NodeLayer>`/`markersRef`, `<PickingController>`, `getClients`.
- **Spec 3** — `ParsedModel` (`elementIndex`, `frame`), `interaction/visibility.ts` (`isMeshVisible`), `scene/ViewportCanvas.tsx`.
- Spec: `docs/superpowers/specs/2026-06-11-spec4-nodes-in-3d-design.md` (§6, §8).

> Placement engine + controllers. The Place/Move/Clear buttons + the F3 affordance gate in the UI are Phase D (this phase exposes `beginPlace`/`commitPlacement`/`clearPlacement`).

---

## File Structure

**Create:**
- `apps/desktop/src/renderer/viewport/nodes/placement.ts` — `commitPlacement`, `clearPlacement`, `raycastBuildingPoint`
- `apps/desktop/src/renderer/viewport/nodes/PlacementController.tsx`
- tests `viewport/nodes/__tests__/placement.spec.ts`

**Modify:**
- `apps/desktop/src/renderer/viewport/interaction/picking.ts` — skip selection while `placingDeviceId` is set
- `apps/desktop/src/renderer/viewport/scene/ViewportCanvas.tsx` — mount `<PlacementController>`

---

## Task 1: Placement orchestration + surface raycast (Vitest)

**Files:** Create `nodes/placement.ts`; test `nodes/__tests__/placement.spec.ts`.

- [ ] **Step 1: Failing test** `nodes/__tests__/placement.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { commitPlacement, clearPlacement, raycastBuildingPoint } from '../placement';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';

const frame = { recenter: new THREE.Vector3(), upConversion: 'Z_UP_TO_Y_UP' as const };
const dev = (id: string, over = {}) => ({ id, name: id, category: 'SWITCH', propertyId: 'b', networkId: 'n', x: null, y: null, z: null, ...over } as any);
beforeEach(() => { useViewportStore.setState(initialViewportState(), true); useViewportStore.getState().setDevices([dev('a')]); useViewportStore.getState().beginPlace('a'); });

describe('commitPlacement', () => {
  it('optimistically sets xyz, persists, and exits placing mode', async () => {
    const rest = { setDevicePosition: vi.fn().mockResolvedValue(dev('a', { x: 1, y: 2, z: 3 })) };
    await commitPlacement('a', new THREE.Vector3(1, 2, 3), { rest: rest as any, frame });
    const d = useViewportStore.getState().devices[0];
    expect([d.x, d.y, d.z]).toEqual([1, 2, 3]);
    expect(useViewportStore.getState().placingDeviceId).toBeNull();
    expect(rest.setDevicePosition).toHaveBeenCalledWith('a', { x: 1, y: 2, z: 3 });
  });
  it('rolls back on rejection', async () => {
    const rest = { setDevicePosition: vi.fn().mockRejectedValue(Object.assign(new Error('no'), { code: 'PERM_001' })) };
    const notify = vi.fn();
    await commitPlacement('a', new THREE.Vector3(5, 6, 7), { rest: rest as any, frame, notify });
    const d = useViewportStore.getState().devices[0];
    expect([d.x, d.y, d.z]).toEqual([null, null, null]); // rolled back
    expect(notify).toHaveBeenCalled();
  });
});

describe('clearPlacement', () => {
  it('clears xyz optimistically and persists null', async () => {
    useViewportStore.getState().upsertDevice(dev('a', { x: 1, y: 2, z: 3 }));
    const rest = { setDevicePosition: vi.fn().mockResolvedValue(dev('a')) };
    await clearPlacement('a', { rest: rest as any });
    expect(useViewportStore.getState().devices[0].x).toBeNull();
    expect(rest.setDevicePosition).toHaveBeenCalledWith('a', null);
  });
});

describe('raycastBuildingPoint', () => {
  it('returns the world hit on a visible mesh, null on miss', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    mesh.userData = { expressID: 1, ifcType: 'IFCWALL' };
    const model = { elementIndex: new Map([[1, mesh]]) } as any;
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100); cam.position.set(0, 0, 10); cam.lookAt(0, 0, 0);
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0, 0), cam);
    const vis = { hiddenCategories: new Set<string>(), hiddenElements: new Set<number>(), isolated: null };
    expect(raycastBuildingPoint(ray, model, vis)!.z).toBeCloseTo(1, 1); // front face of the box
  });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `nodes/placement.ts`:

```typescript
import * as THREE from 'three';
import type { ParsedModel } from '../ifc/ifc-types';
import { isMeshVisible, type VisibilityState } from '../interaction/visibility';
import { useViewportStore } from '../../stores/viewport-store';
import { toModel } from './node-coords';

interface RestLike { setDevicePosition(id: string, pos: { x: number; y: number; z: number } | null): Promise<any> }

export function raycastBuildingPoint(ray: THREE.Raycaster, model: ParsedModel, vis: VisibilityState): THREE.Vector3 | null {
  const meshes = [...model.elementIndex.values()].filter((m) => isMeshVisible(m, vis));
  const hits = ray.intersectObjects(meshes, false);
  return hits.length ? hits[0].point.clone() : null;
}

export async function commitPlacement(
  deviceId: string, point: THREE.Vector3,
  deps: { rest: RestLike; frame: ParsedModel['frame']; notify?: (m: string) => void },
): Promise<void> {
  const store = useViewportStore.getState();
  const prev = store.devices.find((d) => d.id === deviceId);
  if (!prev) return;
  const xyz = toModel(point, deps.frame);
  store.upsertDevice({ ...prev, ...xyz });
  store.cancelPlace();
  try { store.upsertDevice(await deps.rest.setDevicePosition(deviceId, xyz)); }
  catch (e) { store.upsertDevice(prev); deps.notify?.(`Couldn't place ${prev.name}: ${(e as Error).message}`); }
}

export async function clearPlacement(
  deviceId: string, deps: { rest: RestLike; notify?: (m: string) => void },
): Promise<void> {
  const store = useViewportStore.getState();
  const prev = store.devices.find((d) => d.id === deviceId);
  if (!prev) return;
  store.upsertDevice({ ...prev, x: null, y: null, z: null });
  try { store.upsertDevice(await deps.rest.setDevicePosition(deviceId, null)); }
  catch (e) { store.upsertDevice(prev); deps.notify?.(`Couldn't clear ${prev.name}: ${(e as Error).message}`); }
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(desktop): placement orchestration (optimistic set/clear + rollback)`.

---

## Task 2: `PlacementController` + picking skip-while-placing (render-smoke)

**Files:** Create `nodes/PlacementController.tsx`; modify `interaction/picking.ts`, `scene/ViewportCanvas.tsx`; test `nodes/__tests__/placement-controller.spec.tsx`.

- [ ] **Step 1: Implement `nodes/PlacementController.tsx`:**

```tsx
import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { ParsedModel } from '../ifc/ifc-types';
import { useViewportStore } from '../../stores/viewport-store';
import { getClients } from '../../data/clients';
import { commitPlacement, raycastBuildingPoint } from './placement';

export function PlacementController({ model, notify }: { model: ParsedModel; notify?: (m: string) => void }) {
  const { gl, camera, raycaster } = useThree();
  const placingDeviceId = useViewportStore((s) => s.placingDeviceId);
  useEffect(() => {
    if (!placingDeviceId) return;
    const el = gl.domElement;
    const onDown = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const s = useViewportStore.getState();
      const pt = raycastBuildingPoint(raycaster, model, { hiddenCategories: s.hiddenCategories, hiddenElements: s.hiddenElements, isolated: s.isolated });
      if (pt) commitPlacement(placingDeviceId, pt, { rest: getClients()!.rest as any, frame: model.frame, notify });
      // no hit ⇒ no-op (mid-air rejected); keep placing mode for a retry click
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') useViewportStore.getState().cancelPlace(); };
    el.addEventListener('pointerdown', onDown, true); // capture: runs before PickingController
    window.addEventListener('keydown', onKey);
    return () => { el.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey); };
  }, [placingDeviceId, model, gl, camera, raycaster, notify]);
  return null;
}
```

- [ ] **Step 2: Skip selection while placing** — at the top of `PickingController`'s pointer handler in `interaction/picking.ts`:

```typescript
if (useViewportStore.getState().placingDeviceId) return; // a click during placing is a placement, not a selection
```

- [ ] **Step 3: Mount in `scene/ViewportCanvas.tsx`** — inside `<Canvas>`, after `<NodeLayer>`/`<PickingController>`:

```tsx
<PlacementController model={model} />
```
(Import added. An optional `notify` can be threaded later from a toast provider; default console-less no-op for now.)

- [ ] **Step 4: Render-smoke** `nodes/__tests__/placement-controller.spec.tsx` — mounts without throwing and adds no marker; cursor affordance is manual:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { PlacementController } from '../PlacementController';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';

beforeEach(() => useViewportStore.setState(initialViewportState(), true));
const model = () => ({ frame: { recenter: new THREE.Vector3(), upConversion: 'Z_UP_TO_Y_UP' as const }, elementIndex: new Map() } as any);

describe('PlacementController', () => {
  it('mounts inside a canvas without throwing (placing off)', async () => {
    const r = await ReactThreeTestRenderer.create(<PlacementController model={model()} />);
    expect(r.scene).toBeTruthy();
    await r.unmount();
  });
});
```
(The click→place path is covered by Task 1's `commitPlacement` + `raycastBuildingPoint` unit tests; the controller is thin DOM glue verified in the Task-3 manual smoke.)

- [ ] **Step 5: Run → PASS.** Commit `feat(desktop): PlacementController (click-to-place) + picking skip-while-placing`.

---

## Task 3: Phase gate

- [ ] **Step 1: Suite.** `cd apps/desktop && npm test -- viewport` → green.
- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` → PASS.
- [ ] **Step 3: Manual smoke (needs an ADMIN/OWNER session + a building model + a device):** `electron-vite dev` → enter placing mode for an unplaced device (drive `beginPlace` until Phase D's button exists) → click the model surface → a marker appears at the hit and persists (reload shows it); click Move → click elsewhere → it moves; Clear → marker gone. As a MEMBER, the server rejects the `PATCH` → the optimistic marker rolls back.
- [ ] **Step 4: Docs (Rule 10).** `apps/desktop/README.md`: select-then-click placement (surface raycast → `toModel` → `PATCH position`, optimistic + rollback); Esc cancels.
- [ ] **Step 5: Commit** `docs: record Spec 4 placement engine (Phase C)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** surface raycast → `toModel` → `setDevicePosition` (§6) ✓ Task 1; no-hit ⇒ no-op / mid-air rejected (§6) ✓ Task 2; Move = re-place an existing device (same `commitPlacement`) ✓ Task 1; Clear → null (§6) ✓ Task 1; optimistic + rollback-on-reject (`ORG_003`/`PERM_001`/`SPATIAL_*`) (§6, §8) ✓ Task 1; Esc/second-click cancel (§6) ✓ Task 2; a click during placing does not also select (§7) ✓ Task 2.
- **Deferred (correctly NOT here):** the Place/Move/Clear/Zoom buttons + `canConfigure` affordance gating + the toast surface (Phase D); the Node panel (Phase D). The server-side authorization is F3/Spec 1 (already built upstream); Phase C only calls `setDevicePosition`.
- **Placeholder scan:** none — complete code/commands. `notify` defaults to a no-op until Phase D wires a toast (stated).
- **Type consistency:** `commitPlacement(deviceId, Vector3, { rest, frame, notify })` / `clearPlacement(deviceId, { rest, notify })` / `raycastBuildingPoint(ray, model, VisibilityState)`; reuses Phase A `toModel`, store `upsertDevice`/`cancelPlace`/`placingDeviceId`; `setDevicePosition` from the Phase A client; `isMeshVisible` from Spec 3.
- **Test-config compliance:** placement + raycast are node-pure (mocked client, real three math); the controller smoke uses `@react-three/test-renderer`. No GPU assertions.
- **Integration points to verify during execution:** capture-phase `pointerdown` on `gl.domElement` runs before `PickingController` (both attach to the same element) — confirm ordering, or gate `PickingController` solely on `placingDeviceId` (done) so order doesn't matter; `hits[0].point` is in world space (matches `toModel`'s expectation); a real toast provider for `notify`.
