# Spec 4 Phase B — Node Layer, Device Load & Picking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the building's *placed* devices as category-coded marker sprites in Spec 3's r3f scene; load the device list (+ access) and keep it live via realtime; and make markers raycast-pickable with priority over the building so clicking one selects the device.

**Architecture:** `useDeviceLoad` fills `store.devices` on building change and patches it from `v1:device:*` events. `<NodeLayer>` (in the Canvas) renders one billboard `<sprite>` per placed device at `toViewport(device.xyz)`, colored by category, registering the sprites in a shared `markersRef`. Spec 3's `PickingController` is extended: it raycasts the markers first (→ `selectNode`), then the building (→ `selectElement`).

**Tech Stack:** React 19 DOM, `@react-three/fiber`, `three` (Sprite), Zustand, Vitest + `@react-three/test-renderer`, `@nodescope/client` + `@nodescope/shared`.

**Depends on:**
- **Phase A** — `node-coords` (`toViewport`), `node-status`, the store (`devices`/`selection`/`selectNode`/`upsertDevice`/`setDevices`/`removeDevice`/`setAccess`), the client (`listDevicesForBuilding`).
- **Spec 3** — `scene/ViewportCanvas.tsx`, `interaction/picking.ts` (`pickExpressId`, `PickingController`), `ParsedModel` (`elementIndex`, `frame`), `data/clients.ts` (`getClients`).
- Spec: `docs/superpowers/specs/2026-06-11-spec4-nodes-in-3d-design.md` (§5, §7, §10).

> Markers + selection + live list. Placement (Phase C) and the Node panel (Phase D) come next.

---

## File Structure

**Create:**
- `apps/desktop/src/renderer/viewport/nodes/category-color.ts` — `categoryColor(category)`
- `apps/desktop/src/renderer/viewport/nodes/picking-nodes.ts` — `pickNode`
- `apps/desktop/src/renderer/viewport/nodes/NodeLayer.tsx` — marker sprites
- `apps/desktop/src/renderer/viewport/use-device-load.ts` — load + realtime
- tests under `viewport/**/__tests__/*`

**Modify:**
- `apps/desktop/src/renderer/viewport/interaction/picking.ts` — `PickingController` marker priority
- `apps/desktop/src/renderer/viewport/scene/ViewportCanvas.tsx` — `markersRef`, mount `<NodeLayer>`, pass markers to picking
- `apps/desktop/src/renderer/viewport/shell/ViewportHost.tsx` — call `useDeviceLoad()`
- `packages/client/src/rest-client.ts` — `getAccessSummary()`

---

## Task 1: `useDeviceLoad` + `getAccessSummary` (Vitest)

**Files:** Create `use-device-load.ts`; modify `packages/client/src/rest-client.ts`; test `viewport/__tests__/use-device-load.spec.ts`.

- [ ] **Step 1: Client `getAccessSummary`** in `rest-client.ts`:

```typescript
getAccessSummary(): Promise<AccessSummaryDto> { return this.get('/v1/access/me'); }
```

- [ ] **Step 2: Failing test** `viewport/__tests__/use-device-load.spec.ts` (test the core, not the hook wiring):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadDevicesFor, applyDeviceEvent } from '../use-device-load';
import { useViewportStore, initialViewportState } from '../../stores/viewport-store';

beforeEach(() => useViewportStore.setState(initialViewportState(), true));
const dev = (id: string, over = {}) => ({ id, name: id, category: 'SWITCH', propertyId: 'b', networkId: 'n', x: null, y: null, z: null, floor: 1 } as any);

describe('device load', () => {
  it('loadDevicesFor sets the store devices when still current', async () => {
    const rest = { listDevicesForBuilding: vi.fn().mockResolvedValue([dev('a'), dev('b')]) };
    useViewportStore.setState({ activeBuildingPropertyId: 'bld' });
    await loadDevicesFor('bld', rest as any, () => true);
    expect(useViewportStore.getState().devices.map((d) => d.id)).toEqual(['a', 'b']);
  });
  it('discards a stale load', async () => {
    const rest = { listDevicesForBuilding: vi.fn().mockResolvedValue([dev('a')]) };
    await loadDevicesFor('bld', rest as any, () => false); // no longer current
    expect(useViewportStore.getState().devices).toEqual([]);
  });
  it('applyDeviceEvent updates only an already-listed device', () => {
    useViewportStore.getState().setDevices([dev('a')]);
    applyDeviceEvent('updated', { ...dev('a'), x: 1, y: 2, z: 3 });
    expect(useViewportStore.getState().devices[0].x).toBe(1);
    applyDeviceEvent('updated', dev('foreign')); // not listed → ignored
    expect(useViewportStore.getState().devices.map((d) => d.id)).toEqual(['a']);
    applyDeviceEvent('deleted', { id: 'a' } as any);
    expect(useViewportStore.getState().devices).toEqual([]);
  });
});
```

- [ ] **Step 3: Run → FAIL**, then implement `use-device-load.ts`:

```typescript
import { useEffect } from 'react';
import type { DeviceDto } from '@nodescope/shared';
import { WS_EVENTS } from '@nodescope/shared';
import { useViewportStore } from '../stores/viewport-store';
import { getClients } from '../data/clients';

interface RestLike {
  listDevicesForBuilding(id: string): Promise<DeviceDto[]>;
  getAccessSummary?(): Promise<any>;
}

export async function loadDevicesFor(propertyId: string, rest: RestLike, isCurrent: () => boolean): Promise<void> {
  try {
    const ds = await rest.listDevicesForBuilding(propertyId);
    if (isCurrent()) useViewportStore.getState().setDevices(ds);
  } catch { if (isCurrent()) useViewportStore.getState().setDevices([]); }
}

export function applyDeviceEvent(kind: 'updated' | 'created' | 'deleted', payload: DeviceDto | { id: string }): void {
  const store = useViewportStore.getState();
  if (kind === 'deleted') { store.removeDevice(payload.id); return; }
  const d = payload as DeviceDto;
  if (store.devices.some((x) => x.id === d.id)) store.upsertDevice(d); // live-update only listed devices; new ones load on building switch
}

export function useDeviceLoad(): void {
  const propertyId = useViewportStore((s) => s.activeBuildingPropertyId);
  useEffect(() => { // access once
    getClients()?.rest?.getAccessSummary?.().then((a) => useViewportStore.getState().setAccess(a)).catch(() => {});
  }, []);
  useEffect(() => {
    const rest = getClients()?.rest as RestLike | undefined;
    if (!propertyId || !rest) { useViewportStore.getState().setDevices([]); return; }
    let active = true;
    loadDevicesFor(propertyId, rest, () => active && useViewportStore.getState().activeBuildingPropertyId === propertyId);
    return () => { active = false; };
  }, [propertyId]);
  useEffect(() => {
    const rt = getClients()?.realtime;
    if (!rt) return;
    const upd = (d: DeviceDto) => applyDeviceEvent('updated', d);
    const del = (p: { id: string }) => applyDeviceEvent('deleted', p);
    rt.on(WS_EVENTS.DEVICE_UPDATED, upd); rt.on(WS_EVENTS.DEVICE_DELETED, del);
    return () => { rt.off?.(WS_EVENTS.DEVICE_UPDATED, upd); rt.off?.(WS_EVENTS.DEVICE_DELETED, del); };
  }, []);
}
```
Call `useDeviceLoad()` in `shell/ViewportHost.tsx` (next to `useViewportLoader()`).

- [ ] **Step 4: Run → PASS.** Commit `feat(desktop): device load + realtime sync + access summary`.

---

## Task 2: `categoryColor` + `pickNode` + marker-priority picking (Vitest)

**Files:** Create `nodes/category-color.ts`, `nodes/picking-nodes.ts`; modify `interaction/picking.ts`; test `nodes/__tests__/picking-nodes.spec.ts`.

- [ ] **Step 1: `nodes/category-color.ts`** (deterministic palette by category):

```typescript
const PALETTE = [0x4f86f7, 0x35c46a, 0xf5a623, 0xb36ae2, 0xe5484d, 0x21c0c0, 0xe28f3a, 0x8a8f98];
export function categoryColor(category: string): number {
  let h = 0; for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
```

- [ ] **Step 2: Failing test** `nodes/__tests__/picking-nodes.spec.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { pickNode } from '../picking-nodes';

function markerAt(deviceId: string, z: number) {
  const s = new THREE.Sprite(); s.position.set(0, 0, z); s.scale.set(2, 2, 1); s.userData = { deviceId }; return s;
}

describe('pickNode', () => {
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100); cam.position.set(0, 0, 10); cam.lookAt(0, 0, 0);
  const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0, 0), cam);
  it('returns the nearest marker deviceId under the ray', () => {
    expect(pickNode(ray, [markerAt('far', -5), markerAt('near', 5)])).toBe('near');
  });
  it('null when the ray misses every marker', () => {
    const miss = new THREE.Raycaster(); miss.setFromCamera(new THREE.Vector2(0.99, 0.99), cam);
    expect(pickNode(miss, [markerAt('a', 0)])).toBeNull();
  });
});
```

- [ ] **Step 3: Run → FAIL**, then implement `nodes/picking-nodes.ts`:

```typescript
import * as THREE from 'three';

export function pickNode(ray: THREE.Raycaster, markers: THREE.Object3D[]): string | null {
  const hits = ray.intersectObjects(markers, false);
  return hits.length ? ((hits[0].object.userData.deviceId as string) ?? null) : null;
}
```

- [ ] **Step 4: Marker-priority in `interaction/picking.ts`** — `PickingController` takes a `markersRef` and tries nodes first:

```tsx
import { pickNode } from '../nodes/picking-nodes';
// PickingController({ model, markersRef }):
//   on pointerdown, after raycaster.setFromCamera(ndc, camera):
const s = useViewportStore.getState();
const deviceId = pickNode(raycaster, markersRef.current);
if (deviceId) { s.selectNode(deviceId); return; }
const id = pickExpressId(raycaster, model, { hiddenCategories: s.hiddenCategories, hiddenElements: s.hiddenElements, isolated: s.isolated });
id != null ? s.selectElement(id) : s.clearSelection();
```
Change `PickingController`'s props to `{ model: ParsedModel; markersRef: React.RefObject<THREE.Object3D[]> }`.

- [ ] **Step 5: Run → PASS.** Commit `feat(desktop): node picking with marker priority`.

---

## Task 3: `NodeLayer` markers + mount (render-smoke)

**Files:** Create `scene`-adjacent `nodes/NodeLayer.tsx`; modify `scene/ViewportCanvas.tsx`; test `nodes/__tests__/node-layer.spec.tsx`.

- [ ] **Step 1: Implement `nodes/NodeLayer.tsx`** — a sprite per placed device, registered in `markersRef`:

```tsx
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { ParsedModel } from '../ifc/ifc-types';
import { useViewportStore } from '../../stores/viewport-store';
import { toViewport } from './node-coords';
import { categoryColor } from './category-color';
import { STATUS_COLOR } from './node-status';

const isPlaced = (d: { x: number | null; y: number | null; z: number | null }) => d.x !== null && d.y !== null && d.z !== null;

export function NodeLayer({ model, markersRef }: { model: ParsedModel; markersRef: React.MutableRefObject<THREE.Object3D[]> }) {
  const { invalidate } = useThree();
  const devices = useViewportStore((s) => s.devices);
  const selection = useViewportStore((s) => s.selection);
  const nodeStatus = useViewportStore((s) => s.nodeStatus);
  const groupRef = useRef<THREE.Group>(null);

  const placed = useMemo(() => devices.filter(isPlaced), [devices]);

  useEffect(() => { // register the leaf marker sprites (carrying deviceId) for picking + redraw
    const markers: THREE.Object3D[] = [];
    groupRef.current?.traverse((o) => { if ((o.userData as { deviceId?: string })?.deviceId) markers.push(o); });
    markersRef.current = markers;
    invalidate();
  }, [placed, selection, nodeStatus, markersRef, invalidate]);

  return (
    <group ref={groupRef}>
      {placed.map((d) => {
        const p = toViewport({ x: d.x!, y: d.y!, z: d.z! }, model.frame);
        const selected = selection?.kind === 'device' && selection.deviceId === d.id;
        const status = nodeStatus.get(d.id) ?? 'unknown';
        const scale = selected ? 1.6 : 1.1;
        return (
          <group key={d.id} position={[p.x, p.y, p.z]}>
            {/* status ring behind the marker (also carries deviceId so a ring hit selects the device) */}
            <sprite scale={[scale * 1.5, scale * 1.5, 1]} userData={{ deviceId: d.id }}>
              <spriteMaterial color={STATUS_COLOR[status]} opacity={0.5} transparent depthTest={false} />
            </sprite>
            {/* category-colored marker; userData carries the deviceId for picking */}
            <sprite scale={[scale, scale, 1]} userData={{ deviceId: d.id }}>
              <spriteMaterial color={categoryColor(d.category)} depthTest={false} />
            </sprite>
          </group>
        );
      })}
    </group>
  );
}
```
*(`depthTest={false}` keeps markers visible through geometry — they are an annotation layer, independent of section/isolate, per spec §5.)*

- [ ] **Step 2: Mount in `scene/ViewportCanvas.tsx`** — add a `markersRef`, render `<NodeLayer>`, and pass markers to picking:

```tsx
const markersRef = useRef<THREE.Object3D[]>([]);
// inside <Canvas>, after <ModelView>:
<NodeLayer model={model} markersRef={markersRef} />
<PickingController model={model} markersRef={markersRef} />
```
(Replace Spec 3's `<PickingController model={model} />` with the marker-aware one. Imports added.)

- [ ] **Step 3: Failing render-smoke** `nodes/__tests__/node-layer.spec.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { NodeLayer } from '../NodeLayer';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';

const frameModel = () => ({ frame: { recenter: new THREE.Vector3(), upConversion: 'Z_UP_TO_Y_UP' as const } } as any);
beforeEach(() => useViewportStore.setState(initialViewportState(), true));

describe('NodeLayer', () => {
  it('renders a marker only for placed devices', async () => {
    useViewportStore.getState().setDevices([
      { id: 'p', name: 'P', category: 'SWITCH', x: 1, y: 1, z: 1 } as any,
      { id: 'u', name: 'U', category: 'ROUTER', x: null, y: null, z: null } as any,
    ]);
    const r = await ReactThreeTestRenderer.create(<NodeLayer model={frameModel()} markersRef={{ current: [] }} />);
    const sprites = r.scene.findAllByType('Sprite');
    expect(sprites.length).toBe(2); // one placed device → marker + status ring
    await r.unmount();
  });
});
```

- [ ] **Step 4: Run → FAIL → PASS.** Commit `feat(desktop): NodeLayer marker sprites (category + status ring)`.

---

## Task 4: Phase gate

- [ ] **Step 1: Suite.** `cd apps/desktop && npm test -- viewport` → green (device-load, picking-nodes, node-layer, + Spec 3 picking still green).
- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` → PASS.
- [ ] **Step 3: Manual smoke (needs a building with placed devices + API):** `electron-vite dev` → select the building → placed devices appear as colored markers; click one → it emphasizes (device selected); editing a device elsewhere updates its marker live.
- [ ] **Step 4: Docs (Rule 10).** `apps/desktop/README.md`: the node layer (billboard sprites, category color, status ring as a seam) + marker-priority picking.
- [ ] **Step 5: Commit** `docs: record Spec 4 node layer + picking (Phase B)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** markers per placed device, category-coded, status ring (§5, §9) ✓ Task 3; `toViewport` placement of markers (§5) ✓ Task 3; device list load keyed on building + stale-discard (§10) ✓ Task 1; realtime `v1:device:updated`/`deleted` live patch (§10) ✓ Task 1; access load for §8 ✓ Task 1; marker raycast priority → `selectNode` (§7) ✓ Task 2; markers independent of section/isolate (`depthTest:false`, separate layer) (§5) ✓ Task 3.
- **Deferred (correctly NOT here):** placement/move/clear + affordance gating (Phase C); Node panel filters + `DeviceDetails` + status filter (Phase D); created-device live-add (refetch on building switch — noted).
- **Placeholder scan:** none — complete code/commands.
- **Type consistency:** `pickNode(raycaster, markers)`; `PickingController({ model, markersRef })` (Spec 3 call site updated); `NodeLayer({ model, markersRef })`; `categoryColor`/`STATUS_COLOR`; store `devices`/`selectNode`/`upsertDevice`/`removeDevice`/`setAccess` from Phase A; `WS_EVENTS.DEVICE_UPDATED`/`DEVICE_DELETED`; `markersRef: Object3D[]` shared by `NodeLayer`+`PickingController`.
- **Test-config compliance:** `pickNode`/load core are node; `NodeLayer` smoke uses `@react-three/test-renderer`; store-driven, mocked clients. No GPU assertions.
- **Integration points to verify during execution:** `WS_EVENTS.DEVICE_*` exact keys (`@nodescope/shared`); the realtime client `off`/unsubscribe; `markersRef` collects the **leaf** sprites carrying `userData.deviceId` (both the marker and the status ring carry it, so any hit on a marker selects the device) via `traverse`, and `pickNode` raycasts that flat list non-recursively — the test fixture's flat sprites match that shape.
