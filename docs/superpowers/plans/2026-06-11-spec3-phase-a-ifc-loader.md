# Spec 3 Phase A — IFC Loader & ParsedModel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `IfcModelLoader` — the single wrapper over web-ifc's `IfcAPI` that parses an IFC `ArrayBuffer` into a `ParsedModel` (a recentered, Y-up Three.js `Group` of per-element meshes, grouped by IFC category, with an `expressID→Mesh` index, a bbox, the coordinate `frame`, lazy `getProperties`, and `dispose`). Headless and fully unit-tested under node; no React, no WebGL, no canvas.

**Architecture:** A framework-agnostic `viewport/ifc/` module. `createIfcModelLoader({ wasmPath })` returns an object with `loadModel(bytes)`. Internally it `Init`s web-ifc once, `OpenModel`s the bytes, iterates `LoadAllGeometry` building one merged vertex-coloured `BufferGeometry` per element (so each element stays individually pickable/hideable — the §10 batching pass replaces this behind the same interface), parents meshes under per-IFC-class `Group`s, computes the bbox, then recenters (−center) and rotates Z-up→Y-up. The web-ifc model stays open for lazy `getProperties` until `dispose()`.

**Tech Stack:** TypeScript, `web-ifc` (Rust→WASM IFC parser, via npm), `three`, Vitest (node environment — web-ifc and three run headless).

**Depends on:**
- **Spec 2 Phase B/C** — the `apps/desktop` Electron app, `electron-vite`, the `src/renderer/` tree, and the existing `vitest.config.ts`.
- Spec: `docs/superpowers/specs/2026-06-11-spec3-3d-viewport-design.md` (§4 architecture, §5 IFC loader, §11 public interface).

> This phase produces no UI. It is the substrate Phase B (lifecycle) loads, Phase C (scene) renders, and Phase D (interaction) picks/hides. `ParsedModel` and `ElementProperties` defined here are the frozen contract for B/C/D.

---

## File Structure

**Create:**
- `apps/desktop/src/renderer/viewport/ifc/ifc-types.ts` — `ParsedModel`, `ElementProperties`, `IfcType`, `ExpressId` (the cross-phase contract)
- `apps/desktop/src/renderer/viewport/ifc/ifc-model-loader.ts` — `createIfcModelLoader` / `IfcModelLoader`
- `apps/desktop/src/renderer/viewport/ifc/wasm-path.ts` — resolves the web-ifc `.wasm` location (renderer asset vs node_modules)
- `apps/desktop/src/renderer/viewport/ifc/__tests__/ifc-model-loader.spec.ts` — Vitest (node)
- `apps/desktop/src/renderer/viewport/ifc/__tests__/fixtures/wall.ifc` — a minimal single-wall IFC fixture (provenance noted in Task 1)

**Modify:**
- `apps/desktop/package.json` — add `web-ifc`, `three`; dev `@types/three`
- `apps/desktop/electron.vite.config.ts` — copy the web-ifc `.wasm` into the renderer bundle
- `apps/desktop/vitest.config.ts` — a `node`-environment project/override for `viewport/ifc/**` specs (renderer specs are `jsdom`; these are pure node)

---

## Task 1: Dependencies, WASM asset wiring & test fixture

**Files:** `apps/desktop/package.json`, `electron.vite.config.ts`, `vitest.config.ts`, the fixture.

- [ ] **Step 1: Add deps.** `cd apps/desktop && npm i web-ifc three && npm i -D @types/three` → all appear in `apps/desktop/package.json`. (Pin `web-ifc` to the installed version; its `.wasm` filename is `web-ifc.wasm` / `web-ifc-mt.wasm` under `node_modules/web-ifc/`.)

- [ ] **Step 2: Copy the WASM into the renderer bundle.** In `electron.vite.config.ts`, add to the **renderer** config a static copy of `node_modules/web-ifc/web-ifc.wasm` into the renderer output (e.g. a `viteStaticCopy` target, or place a copy under `src/renderer/public/` which electron-vite serves at the web root). Goal: at runtime the renderer can fetch `./web-ifc.wasm` from its own origin.

```typescript
// electron.vite.config.ts — renderer.plugins, add:
import { viteStaticCopy } from 'vite-plugin-static-copy';
// ...
viteStaticCopy({
  targets: [{ src: 'node_modules/web-ifc/web-ifc.wasm', dest: '.' }],
}),
```
(Install `vite-plugin-static-copy` as a devDep if not present: `npm i -D vite-plugin-static-copy`.)

- [ ] **Step 3: Node env for the loader specs.** web-ifc + three run under node (no DOM). Ensure `viewport/ifc/**/*.spec.ts` runs in the `node` environment. In `vitest.config.ts`, either set the top-level `test.environment: 'node'` with a `jsdom` override for `*.spec.tsx`, or add an explicit per-file directive. Add this line at the top of the loader spec to be safe:

```typescript
// @vitest-environment node
```

- [ ] **Step 4: Add the fixture IFC.** Place a **minimal single-wall** `wall.ifc` at `apps/desktop/src/renderer/viewport/ifc/__tests__/fixtures/wall.ifc`. Provenance: export a one-wall model from any IFC tool, or use web-ifc's own test fixture (`web-ifc`'s repo ships small `.ifc` samples). It must be a valid `ISO-10303-21;` STEP file containing ≥1 `IFCWALL`/`IFCWALLSTANDARDCASE` with extruded geometry. Keep it small (a few KB). Commit it with `git add -f` (the repo gitignores nothing under `apps/`, but confirm).

- [ ] **Step 5: Commit** `chore(desktop): add web-ifc + three, WASM bundling, IFC test fixture`.

---

## Task 2: `ifc-types.ts` + `IfcModelLoader` geometry (Vitest TDD)

**Files:** Create `ifc/ifc-types.ts`, `ifc/wasm-path.ts`, `ifc/ifc-model-loader.ts`; test `ifc/__tests__/ifc-model-loader.spec.ts`.

- [ ] **Step 1: Define the contract** `ifc/ifc-types.ts` (frozen for B/C/D):

```typescript
import type * as THREE from 'three';

export type IfcType = string;   // web-ifc class name, e.g. 'IFCWALLSTANDARDCASE'
export type ExpressId = number;

export interface PropertyEntry { name: string; value: string }
export interface PropertySet { name: string; props: PropertyEntry[] }
export interface ElementProperties {
  expressID: ExpressId;
  ifcType: IfcType;
  name: string | null;
  tag: string | null;
  propertySets: PropertySet[];
}

export interface ParsedModel {
  root: THREE.Group;                               // recentered, Y-up; add directly to a scene
  categories: Map<IfcType, THREE.Group>;           // one child group per IFC class
  elementIndex: Map<ExpressId, THREE.Mesh>;        // one merged mesh per element
  bbox: THREE.Box3;                                // in recentered (post-transform) space
  frame: { recenter: THREE.Vector3; upConversion: 'Z_UP_TO_Y_UP' };  // Spec 4 maps stored x/y/z via this
  getProperties(expressID: ExpressId): Promise<ElementProperties>;
  dispose(): void;
}

export interface IfcModelLoader {
  loadModel(bytes: ArrayBuffer): Promise<ParsedModel>;
}
```

- [ ] **Step 2: WASM path resolver** `ifc/wasm-path.ts`:

```typescript
// In the renderer the wasm is bundled at the web root (Task 1 Step 2); in node tests it lives in node_modules.
export function defaultWasmPath(): { path: string; absolute: boolean } {
  // Renderer: served at origin root → relative path, web-ifc fetches `${path}web-ifc.wasm`.
  return { path: '/', absolute: false };
}
```
(Tests pass an explicit absolute path to `node_modules/web-ifc/`; see Step 3.)

- [ ] **Step 3: Write the failing test** `ifc/__tests__/ifc-model-loader.spec.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { createIfcModelLoader } from '../ifc-model-loader';
import type { ParsedModel } from '../ifc-types';

const here = dirname(fileURLToPath(import.meta.url));
const wasmDir = join(here, '../../../../../..', 'node_modules/web-ifc/'); // → apps/desktop/node_modules/web-ifc/
const fixture = readFileSync(join(here, 'fixtures/wall.ifc'));

describe('IfcModelLoader', () => {
  let model: ParsedModel;
  beforeAll(async () => {
    const loader = createIfcModelLoader({ wasmPath: { path: wasmDir, absolute: true } });
    // toArrayBuffer: copy the Buffer's bytes into a standalone ArrayBuffer
    const ab = fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength);
    model = await loader.loadModel(ab);
  });

  it('parses elements into an indexed, categorized, Y-up group', () => {
    expect(model.elementIndex.size).toBeGreaterThan(0);
    expect(model.categories.size).toBeGreaterThan(0);
    // every indexed mesh carries its expressID + ifcType and lives under its category group
    for (const [expressID, mesh] of model.elementIndex) {
      expect(mesh.userData.expressID).toBe(expressID);
      expect(typeof mesh.userData.ifcType).toBe('string');
      expect(model.categories.get(mesh.userData.ifcType)?.children).toContain(mesh);
      expect((mesh.geometry as THREE.BufferGeometry).getAttribute('position').count).toBeGreaterThan(0);
    }
  });

  it('recenters and converts Z-up → Y-up', () => {
    expect(model.frame.upConversion).toBe('Z_UP_TO_Y_UP');
    expect(model.frame.recenter).toBeInstanceOf(THREE.Vector3);
    // after recenter the model bbox is roughly centred on the origin in X/Z
    const c = model.bbox.getCenter(new THREE.Vector3());
    expect(Math.abs(c.x)).toBeLessThan(1e-3);
    expect(Math.abs(c.z)).toBeLessThan(1e-3);
    // Y-up rotation applied on root
    expect(model.root.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('disposes without throwing and frees geometries', () => {
    const sample = [...model.elementIndex.values()][0];
    expect(() => model.dispose()).not.toThrow();
    // geometry attributes are dropped on dispose
    expect((sample.geometry as THREE.BufferGeometry).attributes.position).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run → FAIL.** `cd apps/desktop && npm test -- ifc-model-loader`. Expected: FAIL, `createIfcModelLoader is not a function`.

- [ ] **Step 5: Implement `ifc/ifc-model-loader.ts`:**

```typescript
import * as THREE from 'three';
import { IfcAPI } from 'web-ifc';
import type { ParsedModel, IfcModelLoader, ExpressId, IfcType, ElementProperties } from './ifc-types';
import { defaultWasmPath } from './wasm-path';

export interface LoaderOpts { wasmPath?: { path: string; absolute: boolean } }

export function createIfcModelLoader(opts: LoaderOpts = {}): IfcModelLoader {
  const wasm = opts.wasmPath ?? defaultWasmPath();
  const api = new IfcAPI();
  let ready: Promise<void> | null = null;
  const init = () => (ready ??= (api.SetWasmPath(wasm.path, wasm.absolute), api.Init()));

  async function loadModel(bytes: ArrayBuffer): Promise<ParsedModel> {
    await init();
    const modelID = api.OpenModel(new Uint8Array(bytes), { COORDINATE_TO_ORIGIN: false });

    const root = new THREE.Group();
    const recenterGroup = new THREE.Group();        // holds meshes in native frame, then we offset it
    root.add(recenterGroup);
    const categories = new Map<IfcType, THREE.Group>();
    const elementIndex = new Map<ExpressId, THREE.Mesh>();

    const flat = api.LoadAllGeometry(modelID);
    for (let i = 0; i < flat.size(); i++) {
      const fm = flat.get(i);
      const expressID = fm.expressID as ExpressId;
      const ifcType: IfcType = api.GetNameFromTypeCode(api.GetLineType(modelID, expressID));

      const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
      let base = 0;
      const geoms = fm.geometries;
      for (let j = 0; j < geoms.size(); j++) {
        const placed = geoms.get(j);
        const g = api.GetGeometry(modelID, placed.geometryExpressID);
        const verts = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());   // [px,py,pz,nx,ny,nz]*
        const indices = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
        const m = new THREE.Matrix4().fromArray(placed.flatTransformation as unknown as number[]);
        const nm = new THREE.Matrix3().getNormalMatrix(m);
        const { x: cr, y: cg, z: cb } = placed.color;
        const n = verts.length / 6;
        const p = new THREE.Vector3(), v = new THREE.Vector3();
        for (let k = 0; k < n; k++) {
          p.set(verts[k * 6], verts[k * 6 + 1], verts[k * 6 + 2]).applyMatrix4(m);
          v.set(verts[k * 6 + 3], verts[k * 6 + 4], verts[k * 6 + 5]).applyMatrix3(nm).normalize();
          pos.push(p.x, p.y, p.z); nor.push(v.x, v.y, v.z); col.push(cr, cg, cb);
        }
        for (let k = 0; k < indices.length; k++) idx.push(indices[k] + base);
        base += n;
        g.delete();
      }
      if (!pos.length) continue;

      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      bg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      bg.setIndex(idx);
      const mesh = new THREE.Mesh(bg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      mesh.userData = { expressID, ifcType };

      let group = categories.get(ifcType);
      if (!group) { group = new THREE.Group(); group.name = ifcType; categories.set(ifcType, group); recenterGroup.add(group); }
      group.add(mesh);
      elementIndex.set(expressID, mesh);
    }

    // recenter (in native frame) then convert Z-up → Y-up on root
    const nativeBox = new THREE.Box3().setFromObject(recenterGroup);
    const recenter = nativeBox.getCenter(new THREE.Vector3());
    recenterGroup.position.set(-recenter.x, -recenter.y, -recenter.z);
    root.rotation.x = -Math.PI / 2;
    root.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(root);

    async function getProperties(expressID: ExpressId): Promise<ElementProperties> {
      return readProperties(api, modelID, expressID);   // Task 3
    }
    function dispose(): void {
      for (const mesh of elementIndex.values()) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        mesh.geometry.deleteAttribute('position');
        mesh.geometry.deleteAttribute('normal');
        mesh.geometry.deleteAttribute('color');
      }
      elementIndex.clear(); categories.clear();
      try { api.CloseModel(modelID); } catch { /* already closed */ }
    }

    return { root, categories, elementIndex, bbox, frame: { recenter, upConversion: 'Z_UP_TO_Y_UP' }, getProperties, dispose };
  }

  return { loadModel };
}
```

- [ ] **Step 6: Stub `readProperties`** at the bottom of the file so it compiles (Task 3 implements it for real):

```typescript
import type { ElementProperties } from './ifc-types';
async function readProperties(api: IfcAPI, modelID: number, expressID: number): Promise<ElementProperties> {
  const t = api.GetNameFromTypeCode(api.GetLineType(modelID, expressID));
  return { expressID, ifcType: t, name: null, tag: null, propertySets: [] };
}
```

- [ ] **Step 7: Run → PASS.** `cd apps/desktop && npm test -- ifc-model-loader`. Commit `feat(desktop): IfcModelLoader geometry → ParsedModel (web-ifc + three)`.

---

## Task 3: `getProperties` — element attributes + property sets (Vitest TDD)

**Files:** Modify `ifc/ifc-model-loader.ts` (`readProperties`); extend the spec.

- [ ] **Step 1: Add the failing test** to `ifc-model-loader.spec.ts`:

```typescript
it('getProperties returns type, name/tag and property sets for an element', async () => {
  const loader = createIfcModelLoader({ wasmPath: { path: wasmDir, absolute: true } });
  const ab = fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength);
  const m = await loader.loadModel(ab);
  const id = [...m.elementIndex.keys()][0];
  const props = await m.getProperties(id);
  expect(props.expressID).toBe(id);
  expect(props.ifcType.length).toBeGreaterThan(0);
  expect(Array.isArray(props.propertySets)).toBe(true);
  // shape, not fixture-specifics
  for (const ps of props.propertySets) {
    expect(typeof ps.name).toBe('string');
    for (const p of ps.props) { expect(typeof p.name).toBe('string'); expect(typeof p.value).toBe('string'); }
  }
  m.dispose();
});
```

- [ ] **Step 2: Run → FAIL** (psets always empty from the stub): `cd apps/desktop && npm test -- ifc-model-loader`. (The shape asserts pass but replace the stub for real psets next; if the fixture has no psets the loop is empty — still implement properly.)

- [ ] **Step 3: Implement `readProperties`** (replace the Task 2 stub):

```typescript
function asText(v: any): string {
  if (v == null) return '';
  if (typeof v === 'object' && 'value' in v) return String(v.value);
  return String(v);
}

async function readProperties(api: IfcAPI, modelID: number, expressID: number): Promise<ElementProperties> {
  const ifcType = api.GetNameFromTypeCode(api.GetLineType(modelID, expressID));
  const line = api.GetLine(modelID, expressID);                  // element attributes
  const name = line?.Name ? asText(line.Name) : null;
  const tag = line?.Tag ? asText(line.Tag) : null;

  const sets: { name: string; props: { name: string; value: string }[] }[] = [];
  // web-ifc Properties helper: returns the IfcPropertySet handles defining this element
  const psets: any[] = await api.properties.getPropertySets(modelID, expressID, true);
  for (const ps of psets) {
    const props: { name: string; value: string }[] = [];
    for (const prop of ps.HasProperties ?? []) {
      const p = typeof prop?.value === 'number' ? api.GetLine(modelID, prop.value) : prop;
      if (p?.Name) props.push({ name: asText(p.Name), value: asText(p.NominalValue ?? p.Value ?? '') });
    }
    sets.push({ name: ps?.Name ? asText(ps.Name) : 'PropertySet', props });
  }
  return { expressID, ifcType, name, tag, propertySets: sets };
}
```

> **Note (spec §15 open question):** the exact `api.properties.*` surface (`getPropertySets`, handle vs inlined values) varies across web-ifc versions. Verify against the pinned version during this step; the shape returned (`ElementProperties`) is fixed regardless.

- [ ] **Step 4: Run → PASS.** Commit `feat(desktop): IfcModelLoader.getProperties (attributes + property sets)`.

---

## Task 4: Phase gate

- [ ] **Step 1: Full loader suite.** `cd apps/desktop && npm test -- viewport/ifc` → green (geometry, recenter/Y-up, dispose, getProperties).
- [ ] **Step 2: Typecheck.** `cd apps/desktop && npx tsc --noEmit` → PASS (`ifc-types.ts` is the exported contract).
- [ ] **Step 3: Docs (Rule 10).** Note in `apps/desktop/README.md` that IFC parsing is **client-side, main-thread (v1)** via `viewport/ifc/IfcModelLoader`, that the web-ifc `.wasm` is bundled into the renderer, and that `ParsedModel`/`ElementProperties` are the Spec 3 cross-phase contract.
- [ ] **Step 4: Commit** `docs: record Spec 3 IFC loader + ParsedModel contract (Phase A)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** web-ifc client-side parse (§5) ✓ Task 2; mesh-per-element grouped by IFC category + `expressID` tagging (§5) ✓ Task 2; recenter + Z-up→Y-up + `frame` for Spec 4 (§5, §6, §11) ✓ Task 2; bbox (§5/§11) ✓ Task 2; `elementIndex` (§11) ✓ Task 2; lazy `getProperties` → property sets (§5, §7) ✓ Task 3; `dispose` → `CloseModel` + free buffers (§5, §9) ✓ Task 2; WASM bundled as a renderer asset (§5, §12 no remote-code) ✓ Task 1.
- **Deferred (correctly NOT here):** the store/lifecycle/states (Phase B); the r3f canvas/camera/render (Phase C); picking/inspect/visibility/section UI (Phase D); Worker offload + geometry batching (§10, behind this same `IfcModelLoader` interface).
- **Placeholder scan:** none — complete code throughout. The Task 2 `readProperties` stub is explicitly replaced in Task 3 (a TDD step, not a placeholder).
- **Type consistency:** `ParsedModel` / `ElementProperties` / `IfcType` / `ExpressId` (`ifc-types.ts`) are the exact symbols Phase B (`model` in the store), Phase C (`root`/`bbox`/`categories`), and Phase D (`elementIndex`/`getProperties`/`frame`) consume. `createIfcModelLoader({ wasmPath })` returns `IfcModelLoader`. `mesh.userData = { expressID, ifcType }` is the picking/visibility contract Phase D relies on.
- **Test-config compliance:** loader specs run in the **node** environment (web-ifc + three are headless); renderer specs (Phases B–D) stay `jsdom`. No WebGL is exercised here.
- **Integration points to verify during execution:** the pinned `web-ifc` version's exact `IfcAPI` surface (`GetNameFromTypeCode`, `LoadAllGeometry`/`FlatMesh.geometries`, `GetVertexArray`/`GetIndexArray`, `api.properties.getPropertySets`) and `.wasm` filename; that the fixture `wall.ifc` parses to ≥1 element; the electron-vite static-copy target lands `web-ifc.wasm` at the renderer web root for Phase B's first real `loadModel`.
