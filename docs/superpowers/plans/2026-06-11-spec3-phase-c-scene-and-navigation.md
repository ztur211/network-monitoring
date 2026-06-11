# Spec 3 Phase C — Scene Rendering & Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the `ParsedModel` in an r3f `<Canvas frameloop="demand">` mounted in `ViewportHost`'s `ready` slot, with lighting, orbit/pan/zoom controls, and a camera that auto-fits the model on load. After this phase a building actually shows in 3D and is navigable; interaction (pick/inspect/visibility/section) is Phase D.

**Architecture:** `<ViewportCanvas model>` owns the Canvas (demand render loop; local clipping enabled for Phase D's section plane), mounts `<Lighting>`, drei `<OrbitControls>` (invalidate-on-change so demand frames render during navigation), `<ModelView>` (a `<primitive>` of `model.root`), and `<CameraRig>` (frames `model.bbox`). The fit computation is a pure helper (`fitCameraToBox`) tested headless; the rig applies it via `useThree`.

**Tech Stack:** React 19 DOM, `@react-three/fiber`, `@react-three/drei` (OrbitControls), `three`, Vitest + `@react-three/test-renderer` (headless r3f, no GPU).

**Depends on:**
- **Phase A** — `ParsedModel` (`root`, `bbox`).
- **Phase B** — `ViewportHost` (the `ready` slot + `UpdateBanner`), the store `model`/`status`.
- Spec: `docs/superpowers/specs/2026-06-11-spec3-3d-viewport-design.md` (§4, §6).

> Phase C mounts and frames the model. `<ModelView>` here is minimal (a primitive); Phase D extends it to apply visibility/highlight/clipping and adds picking.

---

## File Structure

**Create:**
- `apps/desktop/src/renderer/viewport/scene/fit.ts` — pure `fitCameraToBox`
- `apps/desktop/src/renderer/viewport/scene/Lighting.tsx`
- `apps/desktop/src/renderer/viewport/scene/ModelView.tsx`
- `apps/desktop/src/renderer/viewport/scene/CameraRig.tsx`
- `apps/desktop/src/renderer/viewport/scene/ViewportCanvas.tsx`
- tests `viewport/scene/__tests__/{fit.spec.ts,viewport-canvas.spec.tsx}`

**Modify:**
- `apps/desktop/package.json` — add `@react-three/fiber`, `@react-three/drei`; dev `@react-three/test-renderer`
- `apps/desktop/src/renderer/shell/ViewportHost.tsx` — render `<ViewportCanvas>` in the `ready` slot

---

## Task 1: Dependencies

**Files:** `apps/desktop/package.json`.

- [ ] **Step 1:** `cd apps/desktop && npm i @react-three/fiber @react-three/drei && npm i -D @react-three/test-renderer` → present in `package.json`. (These align with the installed `three` from Phase A; if peer-dep ranges complain, match `three` to the version `@react-three/fiber` expects.)
- [ ] **Step 2: Commit** `chore(desktop): add react-three-fiber + drei + test-renderer`.

---

## Task 2: `fitCameraToBox` (Vitest, pure)

**Files:** Create `scene/fit.ts`; test `scene/__tests__/fit.spec.ts`.

- [ ] **Step 1: Failing test** `scene/__tests__/fit.spec.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { fitCameraToBox } from '../fit';

describe('fitCameraToBox', () => {
  it('targets the box centre and pulls the camera back far enough to see it', () => {
    const box = new THREE.Box3(new THREE.Vector3(-2, -2, -2), new THREE.Vector3(2, 2, 2));
    const { position, target } = fitCameraToBox(box, 50, 1);
    const center = box.getCenter(new THREE.Vector3());
    expect(target.distanceTo(center)).toBeLessThan(1e-6);
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    expect(position.distanceTo(center)).toBeGreaterThan(radius); // outside the model
  });

  it('handles an empty box without NaN', () => {
    const box = new THREE.Box3(); // empty
    const { position, target } = fitCameraToBox(box, 50, 1);
    expect(Number.isFinite(position.x) && Number.isFinite(target.x)).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `scene/fit.ts`:

```typescript
import * as THREE from 'three';

export function fitCameraToBox(box: THREE.Box3, fovDeg = 50, aspect = 1) {
  const target = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  const sphere = box.isEmpty() ? new THREE.Sphere(target, 1) : box.getBoundingSphere(new THREE.Sphere());
  const r = Math.max(sphere.radius, 0.001);
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.001));
  const dist = r / Math.sin(Math.min(vFov, hFov) / 2);
  // place the camera on a pleasant 3/4 iso direction
  const dir = new THREE.Vector3(1, 0.8, 1).normalize();
  const position = target.clone().add(dir.multiplyScalar(dist * 1.1));
  return { position, target };
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(desktop): fitCameraToBox (frame the model)`.

---

## Task 3: Scene components + ViewportCanvas (render-smoke)

**Files:** Create `scene/{Lighting,ModelView,CameraRig,ViewportCanvas}.tsx`; test `scene/__tests__/viewport-canvas.spec.tsx`.

- [ ] **Step 1: `Lighting.tsx`**

```tsx
export function Lighting() {
  return (
    <>
      <hemisphereLight args={[0xffffff, 0x444455, 1.0]} />
      <directionalLight position={[5, 10, 7]} intensity={1.2} />
      <ambientLight intensity={0.2} />
    </>
  );
}
```

- [ ] **Step 2: `ModelView.tsx`** (Phase C: just mount `root`; Phase D adds visibility/highlight/clip):

```tsx
import type { ParsedModel } from '../ifc/ifc-types';
export function ModelView({ model }: { model: ParsedModel }) {
  return <primitive object={model.root} />;
}
```

- [ ] **Step 3: `CameraRig.tsx`** — frame the box whenever it changes:

```tsx
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { fitCameraToBox } from './fit';

export function CameraRig({ box, controls }: { box: THREE.Box3; controls: React.RefObject<OrbitControlsImpl> }) {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    const { position, target } = fitCameraToBox(box, (camera as THREE.PerspectiveCamera).fov, size.width / size.height);
    camera.position.copy(position);
    camera.lookAt(target);
    if (controls.current) { controls.current.target.copy(target); controls.current.update(); }
    invalidate();
  }, [box, camera, size.width, size.height, controls, invalidate]);
  return null;
}
```

- [ ] **Step 4: `ViewportCanvas.tsx`** — the Canvas wiring:

```tsx
import { useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { ParsedModel } from '../ifc/ifc-types';
import { Lighting } from './Lighting';
import { ModelView } from './ModelView';
import { CameraRig } from './CameraRig';

function InvalidateOnControls({ controls }: { controls: React.RefObject<OrbitControlsImpl> }) {
  const { invalidate } = useThree();
  return <OrbitControls ref={controls} makeDefault onChange={() => invalidate()} />;
}

export function ViewportCanvas({ model }: { model: ParsedModel }) {
  const controls = useRef<OrbitControlsImpl>(null);
  return (
    <Canvas
      frameloop="demand"
      camera={{ fov: 50, near: 0.05, far: 5000, position: [10, 8, 10] }}
      onCreated={({ gl }) => { gl.localClippingEnabled = true; }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={[0x1c1f24]} />
      <Lighting />
      <InvalidateOnControls controls={controls} />
      <ModelView model={model} />
      <CameraRig box={model.bbox} controls={controls} />
    </Canvas>
  );
}
```

- [ ] **Step 5: Failing render-smoke** `scene/__tests__/viewport-canvas.spec.tsx` (headless r3f):

```tsx
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { ViewportCanvas } from '../ViewportCanvas';
import type { ParsedModel } from '../../ifc/ifc-types';

function fakeModel(): ParsedModel {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial());
  mesh.userData = { expressID: 1, ifcType: 'IFCWALL' };
  root.add(mesh);
  return {
    root, categories: new Map([['IFCWALL', root]]), elementIndex: new Map([[1, mesh]]),
    bbox: new THREE.Box3().setFromObject(root),
    frame: { recenter: new THREE.Vector3(), upConversion: 'Z_UP_TO_Y_UP' },
    getProperties: async () => ({ expressID: 1, ifcType: 'IFCWALL', name: null, tag: null, propertySets: [] }),
    dispose: () => {},
  };
}

describe('ViewportCanvas (render smoke)', () => {
  it('mounts the model and lights without throwing', async () => {
    const renderer = await ReactThreeTestRenderer.create(<ViewportCanvas model={fakeModel()} />);
    // the model group is in the scene graph
    const meshes = renderer.scene.findAllByType('Mesh');
    expect(meshes.length).toBeGreaterThan(0);
    const lights = renderer.scene.findAllByType('HemisphereLight');
    expect(lights.length).toBe(1);
    await renderer.unmount();
  });
});
```

- [ ] **Step 6: Run → FAIL → PASS.** `cd apps/desktop && npm test -- viewport-canvas`. Commit `feat(desktop): r3f ViewportCanvas — render + orbit + camera fit`.

---

## Task 4: Mount the canvas in ViewportHost

**Files:** Modify `shell/ViewportHost.tsx` (the `ready` slot only).

- [ ] **Step 1: Replace the Phase B placeholder** in the `ready` branch with the canvas (keep the `UpdateBanner` overlay above it):

```tsx
{status === 'ready' && model && (
  <>
    <ViewportCanvas model={model} />
    {updateAvailable && <UpdateBanner onReload={reload} />}
  </>
)}
```
Add `import { ViewportCanvas } from '../viewport/scene/ViewportCanvas';`. **Test update:** the `ready` slot now renders a real r3f `<Canvas>`, which jsdom can't mount — so in `viewport/ui/__tests__/overlays.spec.tsx` add `vi.mock('../../scene/ViewportCanvas', () => ({ ViewportCanvas: () => null }))` alongside the Phase B hook mocks. The Phase B `updateAvailable` test already asserts only the `Reload` banner (no "Model ready" text), so it passes unchanged once the canvas is stubbed. Remove the placeholder `<div>Model ready — …</div>` from the `ready` slot. Keep the idle/empty/error tests unchanged.

- [ ] **Step 2: Run → PASS.** `cd apps/desktop && npm test -- overlays viewport-canvas` → green.
- [ ] **Step 3: Commit** `feat(desktop): mount ViewportCanvas in the ready viewport slot`.

---

## Task 5: Phase gate

- [ ] **Step 1: Suite.** `cd apps/desktop && npm test -- viewport` → green (fit, canvas smoke, overlays).
- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` → PASS.
- [ ] **Step 3: Manual smoke (needs a building with a model + running API):** `electron-vite dev`, select that building → the model renders; drag to orbit, scroll to zoom, right-drag to pan; the model is framed on load. (GPU/visual correctness is manual per spec §13.)
- [ ] **Step 4: Docs (Rule 10).** `apps/desktop/README.md`: the viewport renders via r3f (`ViewportCanvas`), demand frameloop, orbit controls, auto-fit; note `@react-three/test-renderer` for headless scene tests.
- [ ] **Step 5: Commit** `docs: record Spec 3 scene rendering + navigation (Phase C)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** r3f `<Canvas frameloop="demand">` in `<ViewportHost>` (§4, §6) ✓ Tasks 3–4; `gl.localClippingEnabled` for the section plane (§6, §8) ✓ Task 3; lighting (§6) ✓ Task 3; `<ModelView>` mounts `model.root` (§6) ✓ Task 3; OrbitControls orbit/pan/zoom with demand invalidation (§6, navigation §2) ✓ Task 3; `<CameraRig>` fit-to-bbox on load (§6) ✓ Tasks 2–3.
- **Deferred (correctly NOT here):** zoom-to-selection (needs Phase D selection); applying `isMeshVisible`/highlight/`sectionToPlane` to meshes (Phase D extends `ModelView`); picking, Inspector, Toolbar (Phase D).
- **Placeholder scan:** none — complete component code + a real headless render test. The Phase B `ready` placeholder is explicitly replaced here (Task 4), including the stated test-assertion update.
- **Type consistency:** `ViewportCanvas({ model: ParsedModel })` consumes Phase A's `root`/`bbox`; `fitCameraToBox(Box3, fov, aspect)` is used by `CameraRig`; `OrbitControlsImpl` from `three-stdlib` is the drei controls ref type; `ViewportHost` passes the store `model` (Phase B) into `ViewportCanvas`.
- **Test-config compliance:** `fit.spec.ts` is node; the canvas smoke uses `@react-three/test-renderer` (no real WebGL/GPU) and runs without a DOM canvas. No GPU assertions (per §13 manual).
- **Integration points to verify during execution:** `@react-three/fiber`↔`three` peer-version alignment; that drei `OrbitControls` invalidates demand frames (the explicit `onChange={invalidate}` is a safety net); `three-stdlib` is the source of the `OrbitControls` impl type drei re-exports; jsdom has no real canvas, so only `@react-three/test-renderer` (not `@testing-library` `render`) is used for the Canvas.
