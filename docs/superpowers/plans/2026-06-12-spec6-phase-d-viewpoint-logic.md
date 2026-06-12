# Spec 6 Phase D — Viewpoint Logic (guidIndex, apply & capture) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pure desktop viewpoint primitives: share `toIfcGuid`; extend Spec 3's `ParsedModel` with a `guidIndex` (IFC GlobalId → expressID); and `applyViewpoint` (a BCF viewpoint → viewport camera + resolved selection/visibility) + `captureViewpoint` (live camera + selection → a BCF viewpoint) — all pure and unit-tested.

**Architecture:** `toIfcGuid`/`IFC_B64` move to `@nodescope/shared` (used by the API export + the desktop). Spec 3's `IfcModelLoader` records each element's GlobalId into `guidIndex`. `node-coords` gains `toViewportDir`/`toModelDir` (rotation-only, for camera vectors). `applyViewpoint`/`captureViewpoint` use those to convert between BCF native coords and the recentered-Y-up viewport.

**Tech Stack:** TypeScript, `three`, `web-ifc` (loader extension), Vitest.

**Depends on:**
- **Spec 5** — `toIfcGuid` (extracted here to shared).
- **Spec 3** — `IfcModelLoader`/`ParsedModel` (`frame`, `elementIndex`), `web-ifc`.
- **Spec 4** — `node-coords` (`toViewport`/`toModel`).
- Spec: `2026-06-12-spec6-bcf-design.md` (§7, §9, §11).

> The Issues panel + viewport wiring + realtime are Phase E.

---

## File Structure

**Create:** `apps/desktop/src/renderer/viewport/bcf/{apply-viewpoint.ts, capture-viewpoint.ts}`; tests.
**Modify:** `packages/shared/src/ifc-guid.ts` (move from Spec 5) + re-point `apps/api/src/export/*`; `apps/desktop/src/renderer/viewport/ifc/ifc-model-loader.ts` + `ifc-types.ts` (`guidIndex`); `viewport/nodes/node-coords.ts` (dir helpers).

---

## Task 1: Share `toIfcGuid` + `node-coords` dir helpers

- [ ] **Step 1: Move `toIfcGuid`** — relocate `apps/api/src/export/ifc-guid.ts` → `packages/shared/src/ifc-guid.ts` (export `toIfcGuid`, `IFC_B64` from the shared index). Re-point Spec 5's `ifc2x3-writer.ts`/`export.service.ts` imports to `@nodescope/shared`. Run `cd apps/api && npm run test:unit -- export` → still green. Commit `refactor: share toIfcGuid via @nodescope/shared`.

- [ ] **Step 2: Failing test** `viewport/nodes/__tests__/node-coords-dir.spec.ts`:
```typescript
// @vitest-environment node
import * as THREE from 'three';
import { toViewportDir, toModelDir } from '../node-coords';
const frame = { recenter: new THREE.Vector3(10, 20, 30), upConversion: 'Z_UP_TO_Y_UP' as const };
it('rotates a direction Z-up→Y-up ignoring translation; round-trips', () => {
  const d = toViewportDir({ x: 0, y: 0, z: 1 }, frame); // native +Z → viewport +Y
  expect(d.y).toBeCloseTo(1, 5); expect(Math.abs(d.x) + Math.abs(d.z)).toBeLessThan(1e-6);
  const back = toModelDir(d, frame); expect(back.z).toBeCloseTo(1, 5);
});
```

- [ ] **Step 3: Run → FAIL**, then add to `node-coords.ts` (rotation-only, no recenter):
```typescript
const ROT = () => new THREE.Matrix4().makeRotationX(-Math.PI / 2);
export function toViewportDir(v: { x: number; y: number; z: number }, _frame: ParsedModel['frame']): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(ROT());
}
export function toModelDir(v: THREE.Vector3, _frame: ParsedModel['frame']): { x: number; y: number; z: number } {
  const r = v.clone().applyMatrix4(ROT().invert()); return { x: r.x, y: r.y, z: r.z };
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(desktop): node-coords direction helpers`.

---

## Task 2: `ParsedModel.guidIndex` (Vitest, fixture IFC)

**Files:** Modify `ifc/ifc-types.ts` (+ `guidIndex`), `ifc/ifc-model-loader.ts`.

- [ ] **Step 1: Failing test** — the loader records each element's IFC GlobalId:
```typescript
// extends the Spec 3 loader spec (node + the wall.ifc fixture)
it('builds a guidIndex mapping IFC GlobalId → expressID', async () => {
  const model = await loader.loadModel(ab); // from the Spec 3 fixture
  expect(model.guidIndex.size).toBe(model.elementIndex.size);
  for (const [guid, expressID] of model.guidIndex) { expect(typeof guid).toBe('string'); expect(model.elementIndex.has(expressID)).toBe(true); }
});
```

- [ ] **Step 2: Run → FAIL**, then extend the loader. In `ifc-types.ts` add `guidIndex: Map<string, ExpressId>` to `ParsedModel`. In `ifc-model-loader.ts`, while iterating elements, read each `expressID`'s GlobalId and record it:
```typescript
const guidIndex = new Map<string, ExpressId>();
// inside the per-element loop, after computing expressID:
const line = api.GetLine(modelID, expressID); // has GlobalId for IfcRoot subtypes
if (line?.GlobalId?.value) guidIndex.set(line.GlobalId.value, expressID);
// include guidIndex in the returned ParsedModel
```

- [ ] **Step 3: Run → PASS.** Commit `feat(desktop): ParsedModel guidIndex (GlobalId → expressID)`.

---

## Task 3: `applyViewpoint` (Vitest)

**Files:** Create `bcf/apply-viewpoint.ts`; test `bcf/__tests__/apply-viewpoint.spec.ts`.

- [ ] **Step 1: Failing test:**
```typescript
// @vitest-environment node
import * as THREE from 'three';
import { applyViewpoint } from '../apply-viewpoint';
import { toIfcGuid } from '@nodescope/shared';

const frame = { recenter: new THREE.Vector3(), upConversion: 'Z_UP_TO_Y_UP' as const };
it('resolves camera + splits component GUIDs into devices and elements', () => {
  const vp = { camera: { kind: 'perspective', position: [0, 0, 5], direction: [0, 0, -1], up: [0, 1, 0], fieldOfView: 60 },
    components: { selection: [toIfcGuid('dev1'), 'ELEM-GUID'], visibility: { defaultVisibility: true, exceptions: ['ELEM-HIDDEN'] } } } as any;
  const r = applyViewpoint(vp, frame, new Map([['ELEM-GUID', 7], ['ELEM-HIDDEN', 9]]), new Map([[toIfcGuid('dev1'), 'dev1']]));
  expect(r.selectionDeviceIds).toEqual(['dev1']);
  expect(r.selectionExpressIds).toEqual([7]);
  expect(r.hiddenExpressIds).toEqual([9]);     // defaultVisibility true → exceptions hidden
  expect(r.camera.position.y).toBeCloseTo(5, 5); // native +Z (=5) → viewport +Y
});
```

- [ ] **Step 2: Run → FAIL**, then implement `apply-viewpoint.ts`:
```typescript
import * as THREE from 'three';
import type { ParsedModel, ExpressId } from '../ifc/ifc-types';
import { toViewport, toViewportDir } from '../nodes/node-coords';

export interface ResolvedViewpoint { camera: { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; fov: number };
  selectionDeviceIds: string[]; selectionExpressIds: ExpressId[]; hiddenExpressIds: ExpressId[]; }

export function applyViewpoint(vp: { camera: any; components: any }, frame: ParsedModel['frame'], guidIndex: Map<string, ExpressId>, deviceGuidMap: Map<string, string>): ResolvedViewpoint {
  const position = toViewport({ x: vp.camera.position[0], y: vp.camera.position[1], z: vp.camera.position[2] }, frame);
  const dir = toViewportDir({ x: vp.camera.direction[0], y: vp.camera.direction[1], z: vp.camera.direction[2] }, frame);
  const up = toViewportDir({ x: vp.camera.up[0], y: vp.camera.up[1], z: vp.camera.up[2] }, frame);
  const sel = vp.components.selection as string[];
  const selectionDeviceIds: string[] = []; const selectionExpressIds: ExpressId[] = [];
  for (const g of sel) { const dev = deviceGuidMap.get(g); if (dev) selectionDeviceIds.push(dev); else { const e = guidIndex.get(g); if (e != null) selectionExpressIds.push(e); } }
  const vis = vp.components.visibility;
  const hiddenExpressIds = vis.defaultVisibility
    ? (vis.exceptions as string[]).map((g) => guidIndex.get(g)).filter((e): e is ExpressId => e != null)        // hide the exceptions
    : [...guidIndex.values()].filter((e) => !new Set((vis.exceptions as string[]).map((g) => guidIndex.get(g))).has(e)); // hide all but exceptions
  return { camera: { position, target: position.clone().add(dir), up, fov: vp.camera.fieldOfView ?? 50 }, selectionDeviceIds, selectionExpressIds, hiddenExpressIds };
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(desktop): applyViewpoint (BCF viewpoint → viewport state)`.

---

## Task 4: `captureViewpoint` (Vitest)

**Files:** Create `bcf/capture-viewpoint.ts`; test `bcf/__tests__/capture-viewpoint.spec.ts`.

- [ ] **Step 1: Failing test:**
```typescript
// @vitest-environment node
import * as THREE from 'three';
import { captureViewpoint } from '../capture-viewpoint';
import { toIfcGuid } from '@nodescope/shared';
const frame = { recenter: new THREE.Vector3(), upConversion: 'Z_UP_TO_Y_UP' as const };
it('captures the live camera into a BCF viewpoint (native coords) with the selected device GUID', () => {
  const vp = captureViewpoint({ position: new THREE.Vector3(0, 5, 0), target: new THREE.Vector3(0, 0, 0), up: new THREE.Vector3(0, 0, -1), fov: 60 }, frame, 'dev1');
  expect(vp.camera.position).toEqual([0, 0, 5]);                 // viewport +Y (=5) → native +Z
  expect(vp.components.selection).toEqual([toIfcGuid('dev1')]);
  expect(vp.camera.kind).toBe('perspective');
});
```

- [ ] **Step 2: Run → FAIL**, then implement `capture-viewpoint.ts`:
```typescript
import * as THREE from 'three';
import type { ParsedModel } from '../ifc/ifc-types';
import { toModel, toModelDir } from '../nodes/node-coords';
import { toIfcGuid } from '@nodescope/shared';

export function captureViewpoint(cam: { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; fov: number }, frame: ParsedModel['frame'], selectedDeviceId?: string) {
  const position = toModel(cam.position, frame);
  const targetN = toModel(cam.target, frame);
  const direction = { x: targetN.x - position.x, y: targetN.y - position.y, z: targetN.z - position.z };
  const len = Math.hypot(direction.x, direction.y, direction.z) || 1;
  const up = toModelDir(cam.up, frame);
  return {
    camera: { kind: 'perspective' as const, position: [position.x, position.y, position.z], direction: [direction.x / len, direction.y / len, direction.z / len], up: [up.x, up.y, up.z], fieldOfView: cam.fov },
    components: { selection: selectedDeviceId ? [toIfcGuid(selectedDeviceId)] : [], visibility: { defaultVisibility: true, exceptions: [] } },
  };
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(desktop): captureViewpoint (viewport → BCF viewpoint)`.

---

## Task 5: Phase gate

- [ ] **Step 1: Suites.** `cd apps/desktop && npm test -- bcf node-coords-dir ifc-model-loader`; `cd apps/api && npm run test:unit -- export` → green.
- [ ] **Step 2: Typecheck** (desktop + api + shared) → PASS.
- [ ] **Step 3: Docs (Rule 10).** Note the `ParsedModel.guidIndex` extension + the shared `toIfcGuid` in the SAD/CLAUDE.md.
- [ ] **Step 4: Commit** `docs: record Spec 6 viewpoint logic (Phase D)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** shared `toIfcGuid` (§7, §9) ✓ Task 1; `ParsedModel.guidIndex` element resolution (§7, §11) ✓ Task 2; `applyViewpoint` — camera convert + device/element GUID split + visibility (§9) ✓ Task 3; `captureViewpoint` — native camera + selected-device GUID (§9) ✓ Task 4; node-coords direction helpers (§9) ✓ Task 1.
- **Deferred (correctly NOT here):** the Issues panel, viewport wiring (applying the resolved camera/visibility via Spec 3 `ViewCommands` + the stores), `toDataURL` capture, and realtime (Phase E). Inverse-visibility (`defaultVisibility:false`) is handled but flagged for viewport verification.
- **Placeholder scan:** none — complete code.
- **Type consistency:** `ResolvedViewpoint` (Task 3) ↔ Phase E's viewport application; `captureViewpoint` output shape ↔ Phase C's `CreateBcfTopicDto.viewpoint`; `toViewport`/`toViewportDir`/`toModel`/`toModelDir` (Spec 4 + here); `toIfcGuid` (shared); `guidIndex`/`elementIndex` (Spec 3).
- **Test-config compliance:** all pure Vitest node (three math, no WebGL); the loader test reuses the Spec 3 node fixture.
- **Integration points to verify during execution:** the exact `web-ifc` API to read an element's `GlobalId` (`GetLine(...).GlobalId.value` vs a properties call); that moving `ifc-guid.ts` doesn't orphan Spec 5 importers (only the writer + service import it); BCF camera vector conventions (direction sign) against a real tool.
