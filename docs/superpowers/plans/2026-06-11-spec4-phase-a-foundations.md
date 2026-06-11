# Spec 4 Phase A — Foundations (Coords, Helpers, Client, Store & Selection) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless foundation for nodes-in-3D: the `node-coords` bridge (`device.x/y/z` ↔ viewport via `ParsedModel.frame`), the pure helpers (`NodeStatus`, `filterDevices`, `canConfigure`), the `@nodescope/client` device methods + the server `?buildingPropertyId` device filter, and the `viewport-store` node-state — including refactoring Spec 3's `selection` into a tagged `element | device` union. No r3f, no markers, no UI yet.

**Architecture:** A new `viewport/nodes/` module holds pure logic. The store grows node state + a tagged selection union, and Spec 3's three selection consumers (`picking`, `apply-model-state`, `Inspector`) are updated to the union so the app stays green. The device list is fetched through a new client method backed by an F3-scope-filtered, subtree-resolved `?buildingPropertyId` filter on the existing `GET /v1/devices`.

**Tech Stack:** TypeScript, `three` (Matrix4/Vector3 in `node-coords`), Zustand, Vitest (node + jsdom), NestJS/Prisma/Jest (the server filter), `@nodescope/client` + `@nodescope/shared`.

**Depends on:**
- **Spec 3** — `ifc/ifc-types.ts` (`ParsedModel.frame`, `ExpressId`), `stores/viewport-store.ts` (the Spec 3 state), `interaction/picking.ts` (`pickExpressId`, `PickingController`), `scene/apply-model-state.ts`, `ui/Inspector.tsx`.
- **F2/F3** — `PropertiesService.subtreePropertyIds(buildingPropertyId)`, F3 `scopeFilter`/scope-filtered reads, `AccessSummaryDto` (`role`, `assignedRootPropertyIds`, `unscoped`).
- **Spec 1** — `DeviceDto.x/y/z`, `PATCH /v1/devices/:id/position` (`DevicePositionDto`).
- Spec: `docs/superpowers/specs/2026-06-11-spec4-nodes-in-3d-design.md` (§5, §7 selection, §8, §9, §10).

> No markers/scene (Phase B), no placement (Phase C), no panel (Phase D). This phase defines the contracts B/C/D consume.

---

## File Structure

**Create:**
- `apps/desktop/src/renderer/viewport/nodes/node-coords.ts` — `toViewport` / `toModel`
- `apps/desktop/src/renderer/viewport/nodes/node-status.ts` — `NodeStatus` + `STATUS_COLOR`
- `apps/desktop/src/renderer/viewport/nodes/filter-devices.ts` — `filterDevices` + `NodeFilter`
- `apps/desktop/src/renderer/viewport/nodes/can-configure.ts` — `canConfigure`
- tests `viewport/nodes/__tests__/*.spec.ts`

**Modify:**
- `apps/desktop/src/renderer/stores/viewport-store.ts` — node state + tagged `Selection`
- `apps/desktop/src/renderer/viewport/interaction/picking.ts`, `scene/apply-model-state.ts`, `ui/Inspector.tsx` — adopt the `Selection` union
- `packages/client/src/*` (`@nodescope/client`) — `listDevicesForBuilding`, `setDevicePosition`
- `apps/api/src/devices/devices.{controller,service,repository}.ts` — `?buildingPropertyId` filter

---

## Task 1: `node-coords` (Vitest, node)

**Files:** Create `nodes/node-coords.ts`; test `nodes/__tests__/node-coords.spec.ts`.

- [ ] **Step 1: Failing test** (`@vitest-environment node`):

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { toViewport, toModel } from '../node-coords';

const frame = { recenter: new THREE.Vector3(10, 20, 30), upConversion: 'Z_UP_TO_Y_UP' as const };

describe('node-coords', () => {
  it('maps native Z-up → viewport Y-up about the recenter', () => {
    // a point at the recenter maps to the origin; native +Z becomes viewport +Y
    expect(toViewport({ x: 10, y: 20, z: 30 }, frame).length()).toBeLessThan(1e-6);
    const up = toViewport({ x: 10, y: 20, z: 31 }, frame); // +1 in native Z
    expect(up.y).toBeCloseTo(1, 5);
    expect(Math.abs(up.x) + Math.abs(up.z)).toBeLessThan(1e-6);
  });
  it('round-trips toModel(toViewport(p)) ≈ p', () => {
    const p = { x: 12.5, y: 7, z: 41.2 };
    const back = toModel(toViewport(p, frame), frame);
    expect(back.x).toBeCloseTo(p.x, 4); expect(back.y).toBeCloseTo(p.y, 4); expect(back.z).toBeCloseTo(p.z, 4);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/desktop && npm test -- node-coords`.

- [ ] **Step 3: Implement `nodes/node-coords.ts`:**

```typescript
import * as THREE from 'three';
import type { ParsedModel } from '../ifc/ifc-types';

type Frame = ParsedModel['frame'];
type Xyz = { x: number; y: number; z: number };

/** M = Rx(-90°) · T(-recenter) — the same transform Spec 3 applies to ParsedModel.root. */
function frameMatrix(frame: Frame): THREE.Matrix4 {
  const r = frame.recenter;
  return new THREE.Matrix4().makeRotationX(-Math.PI / 2)
    .multiply(new THREE.Matrix4().makeTranslation(-r.x, -r.y, -r.z));
}

export function toViewport(xyz: Xyz, frame: Frame): THREE.Vector3 {
  return new THREE.Vector3(xyz.x, xyz.y, xyz.z).applyMatrix4(frameMatrix(frame));
}

export function toModel(point: THREE.Vector3, frame: Frame): Xyz {
  const v = point.clone().applyMatrix4(frameMatrix(frame).invert());
  return { x: v.x, y: v.y, z: v.z };
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(desktop): node-coords (device xyz ↔ viewport frame)`.

---

## Task 2: Pure helpers — `node-status`, `can-configure`, `filter-devices` (Vitest)

**Files:** Create the three modules; test `nodes/__tests__/{filter-devices,can-configure}.spec.ts`.

- [ ] **Step 1: `nodes/node-status.ts`:**

```typescript
export type NodeStatus = 'up' | 'down' | 'warning' | 'unknown';
export const STATUS_COLOR: Record<NodeStatus, number> = {
  up: 0x35c46a, down: 0xe5484d, warning: 0xf5a623, unknown: 0x8a8f98,
};
```

- [ ] **Step 2: `nodes/can-configure.ts`** + a failing test. Test `nodes/__tests__/can-configure.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { canConfigure } from '../can-configure';

describe('canConfigure', () => {
  it('OWNER and ADMIN may configure; MEMBER may not; null → false', () => {
    expect(canConfigure({ role: 'OWNER', assignedRootPropertyIds: [], unscoped: true })).toBe(true);
    expect(canConfigure({ role: 'ADMIN', assignedRootPropertyIds: ['p'], unscoped: false })).toBe(true);
    expect(canConfigure({ role: 'MEMBER', assignedRootPropertyIds: ['p'], unscoped: false })).toBe(false);
    expect(canConfigure(null)).toBe(false);
  });
});
```
Implement:
```typescript
import type { AccessSummaryDto } from '@nodescope/shared';
// The device list is already F3 read-scope-filtered and ADMIN read-scope == configure-scope (F3 §5),
// so any LISTED device is configurable by an OWNER/ADMIN — a role gate suffices.
export function canConfigure(access: AccessSummaryDto | null): boolean {
  return access?.role === 'OWNER' || access?.role === 'ADMIN';
}
```

- [ ] **Step 3: `nodes/filter-devices.ts`** + a failing test `nodes/__tests__/filter-devices.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { filterDevices, emptyFilter } from '../filter-devices';
import type { DeviceDto } from '@nodescope/shared';

const dev = (over: Partial<DeviceDto>): DeviceDto => ({
  id: 'd', organizationId: 'o', name: 'Switch-1', category: 'SWITCH', propertyId: 'b', networkId: 'n',
  latitude: null, longitude: null, floor: 1, floorLabel: null, x: null, y: null, z: null,
  ipAddress: '10.0.0.5', macAddress: null, notes: null, version: 1, createdAt: '', updatedAt: '', ...over,
} as DeviceDto);

const statusOf = () => 'unknown' as const;

describe('filterDevices', () => {
  const ds = [dev({ id: 'a', name: 'Switch-1', category: 'SWITCH', x: 1, y: 2, z: 3 }),
              dev({ id: 'b', name: 'Router-9', category: 'ROUTER', networkId: 'n2', floor: 2 })];
  it('text matches name/ip', () => expect(filterDevices(ds, { ...emptyFilter(), text: 'router' }, statusOf).map(d => d.id)).toEqual(['b']));
  it('category filter', () => expect(filterDevices(ds, { ...emptyFilter(), categories: new Set(['SWITCH']) }, statusOf).map(d => d.id)).toEqual(['a']));
  it('placement: placed vs unplaced', () => {
    expect(filterDevices(ds, { ...emptyFilter(), placement: 'placed' }, statusOf).map(d => d.id)).toEqual(['a']);
    expect(filterDevices(ds, { ...emptyFilter(), placement: 'unplaced' }, statusOf).map(d => d.id)).toEqual(['b']);
  });
  it('network + floor', () => expect(filterDevices(ds, { ...emptyFilter(), networkId: 'n2', floor: 2 }, statusOf).map(d => d.id)).toEqual(['b']));
});
```
Implement:
```typescript
import type { DeviceDto } from '@nodescope/shared';
import type { NodeStatus } from './node-status';

export interface NodeFilter {
  text: string; categories: Set<string>; networkId: string | null;
  placement: 'all' | 'placed' | 'unplaced'; floor: number | null; status: NodeStatus | null;
}
export const emptyFilter = (): NodeFilter => ({ text: '', categories: new Set(), networkId: null, placement: 'all', floor: null, status: null });

const isPlaced = (d: DeviceDto) => d.x !== null && d.y !== null && d.z !== null;

export function filterDevices(devices: DeviceDto[], f: NodeFilter, statusOf: (id: string) => NodeStatus): DeviceDto[] {
  const t = f.text.trim().toLowerCase();
  return devices.filter((d) => {
    if (t && !`${d.name} ${d.ipAddress ?? ''} ${d.macAddress ?? ''}`.toLowerCase().includes(t)) return false;
    if (f.categories.size && !f.categories.has(d.category)) return false;
    if (f.networkId && d.networkId !== f.networkId) return false;
    if (f.placement === 'placed' && !isPlaced(d)) return false;
    if (f.placement === 'unplaced' && isPlaced(d)) return false;
    if (f.floor !== null && d.floor !== f.floor) return false;
    if (f.status && statusOf(d.id) !== f.status) return false;
    return true;
  });
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(desktop): node-status, canConfigure, filterDevices`.

---

## Task 3: Server `?buildingPropertyId` device filter (Jest, api)

**Files:** Modify `apps/api/src/devices/devices.{controller,service,repository}.ts`; test `devices/__tests__/devices.repository.spec.ts` (or the e2e).

- [ ] **Step 1: Failing integration test** (extend `devices.repository.spec.ts`): listing by a building returns devices whose `propertyId` is at/under that building, scope-filtered.

```typescript
it('lists devices under a building subtree, scope-filtered', async () => {
  // site → building → floor; devices on the floor are under the building
  const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'S' } });
  const bld  = await prisma.property.create({ data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'B' } });
  const floor = await prisma.property.create({ data: { organizationId: orgId, parentId: bld.id, type: 'FLOOR', name: 'F1' } });
  const net = await prisma.network.create({ data: { organizationId: orgId, name: 'N' } });
  const onFloor = await prisma.device.create({ data: { organizationId: orgId, name: 'A', category: 'SWITCH', propertyId: floor.id, networkId: net.id } });
  await prisma.device.create({ data: { organizationId: orgId, name: 'B', category: 'SWITCH', propertyId: site.id, networkId: net.id } }); // not under bld
  const rows = await repo.listForBuilding(orgId, bld.id, /* scopePropertyIds */ null);
  expect(rows.map((d) => d.id)).toEqual([onFloor.id]);
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:integration -- devices.repository`.

- [ ] **Step 3: Implement.** Repository — resolve the subtree (via `PropertiesService.subtreePropertyIds`) and `AND` the F3 scope set:

```typescript
// devices.repository.ts
async listForBuilding(organizationId: string, buildingPropertyId: string, scopePropertyIds: string[] | null): Promise<Device[]> {
  const subtree = await this.properties.subtreePropertyIds(organizationId, buildingPropertyId); // F2 seam
  const propertyIdIn = scopePropertyIds ? subtree.filter((id) => scopePropertyIds.includes(id)) : subtree;
  if (!propertyIdIn.length) return [];
  return this.prisma.device.findMany({ where: { organizationId, propertyId: { in: propertyIdIn } } });
}
```
Service passes the caller's F3 scope (`null` for OWNER, else `scopeFilter(memberId).propertyIdIn`). Controller adds the query param:

```typescript
// devices.controller.ts
@Get()
list(@OrgId() orgId: string, @CurrentMember() m: Member, @Query('buildingPropertyId') buildingPropertyId?: string) {
  return buildingPropertyId
    ? this.service.listForBuilding(orgId, m, buildingPropertyId)
    : this.service.list(orgId, m); // existing path
}
```
(`service.listForBuilding` computes `scopePropertyIds = m.role === 'OWNER' ? null : (await this.permissions.scopeFilter(m.id)).propertyIdIn` and maps rows → `DeviceDto`.)

- [ ] **Step 4: Run → PASS.** Commit `feat(api): GET /v1/devices?buildingPropertyId (subtree + scope filtered)`.

---

## Task 4: `@nodescope/client` device methods (Vitest)

**Files:** Modify `packages/client/src/rest-client.ts` (or equivalent); test `packages/client/src/__tests__/devices.spec.ts`.

- [ ] **Step 1: Failing test** (mocked `fetch`): `listDevicesForBuilding` GETs the right URL + unwraps; `setDevicePosition` PATCHes `/position`.

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createRestClient } from '../rest-client';

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data, timestamp: '' }) } as Response);

describe('device client', () => {
  it('listDevicesForBuilding hits the scoped query', async () => {
    const fetchMock = vi.fn().mockReturnValue(ok([{ id: 'd' }]));
    const c = createRestClient({ baseUrl: 'http://x/api', getToken: async () => 't', fetchImpl: fetchMock });
    const out = await c.listDevicesForBuilding('bld-1');
    expect(out).toEqual([{ id: 'd' }]);
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/devices?buildingPropertyId=bld-1');
  });
  it('setDevicePosition PATCHes the position endpoint', async () => {
    const fetchMock = vi.fn().mockReturnValue(ok({ id: 'd', x: 1, y: 2, z: 3 }));
    const c = createRestClient({ baseUrl: 'http://x/api', getToken: async () => 't', fetchImpl: fetchMock });
    await c.setDevicePosition('d', { x: 1, y: 2, z: 3 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/devices/d/position'); expect(init.method).toBe('PATCH');
  });
});
```

- [ ] **Step 2: Run → FAIL**, then add to the REST client:

```typescript
listDevicesForBuilding(buildingPropertyId: string): Promise<DeviceDto[]> {
  return this.get(`/v1/devices?buildingPropertyId=${encodeURIComponent(buildingPropertyId)}`);
}
setDevicePosition(id: string, pos: { x: number; y: number; z: number } | null): Promise<DeviceDto> {
  return this.patch(`/v1/devices/${id}/position`, pos ?? { x: null, y: null, z: null });
}
```
(Uses the client's existing `get`/`patch` envelope helpers; `DeviceDto` from `@nodescope/shared`. If the client takes no `fetchImpl` injection today, add an optional `fetchImpl` param defaulting to global `fetch` for testability.)

- [ ] **Step 3: Run → PASS.** Commit `feat(client): listDevicesForBuilding + setDevicePosition`.

---

## Task 5: Store node-state + tagged `Selection` refactor (Vitest)

**Files:** Modify `stores/viewport-store.ts`; update `interaction/picking.ts`, `scene/apply-model-state.ts`, `ui/Inspector.tsx`; tests updated.

- [ ] **Step 1: Failing test** `stores/__tests__/viewport-store-nodes.spec.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useViewportStore, initialViewportState } from '../viewport-store';

const reset = () => useViewportStore.setState(initialViewportState(), true);
const dev = (id: string, over = {}) => ({ id, name: id, category: 'SWITCH', propertyId: 'b', networkId: 'n', x: null, y: null, z: null, floor: 1 } as any);

describe('viewportStore nodes + selection', () => {
  beforeEach(reset);
  it('tagged selection: element vs device, mutually exclusive', () => {
    useViewportStore.getState().selectElement(7);
    expect(useViewportStore.getState().selection).toEqual({ kind: 'element', expressID: 7 });
    useViewportStore.getState().selectNode('d1');
    expect(useViewportStore.getState().selection).toEqual({ kind: 'device', deviceId: 'd1' });
    useViewportStore.getState().clearSelection();
    expect(useViewportStore.getState().selection).toBeNull();
  });
  it('setDevices / upsertDevice / removeDevice', () => {
    useViewportStore.getState().setDevices([dev('a'), dev('b')]);
    useViewportStore.getState().upsertDevice({ ...dev('a'), x: 1, y: 2, z: 3 });
    expect(useViewportStore.getState().devices.find((d) => d.id === 'a').x).toBe(1);
    useViewportStore.getState().removeDevice('b');
    expect(useViewportStore.getState().devices.map((d) => d.id)).toEqual(['a']);
  });
  it('begin/cancel place and status', () => {
    useViewportStore.getState().beginPlace('a');
    expect(useViewportStore.getState().placingDeviceId).toBe('a');
    useViewportStore.getState().cancelPlace();
    expect(useViewportStore.getState().placingDeviceId).toBeNull();
    useViewportStore.getState().setNodeStatus('a', 'down');
    expect(useViewportStore.getState().nodeStatus.get('a')).toBe('down');
  });
});
```

- [ ] **Step 2: Run → FAIL**, then extend the store. Add the union + node state (keep all Spec 3 fields):

```typescript
import type { DeviceDto, AccessSummaryDto } from '@nodescope/shared';
import type { ExpressId } from '../viewport/ifc/ifc-types';
import { type NodeFilter, emptyFilter } from '../viewport/nodes/filter-devices';
import type { NodeStatus } from '../viewport/nodes/node-status';

export type Selection =
  | { kind: 'element'; expressID: ExpressId }
  | { kind: 'device'; deviceId: string }
  | null;

// in ViewportState — REPLACE `selection: ExpressId | null` with:
  selection: Selection;
  devices: DeviceDto[];
  placingDeviceId: string | null;
  nodeFilter: NodeFilter;
  nodeStatus: Map<string, NodeStatus>;
  access: AccessSummaryDto | null;
// actions:
  selectElement: (id: ExpressId) => void;
  selectNode: (deviceId: string) => void;
  clearSelection: () => void;
  setDevices: (d: DeviceDto[]) => void;
  upsertDevice: (d: DeviceDto) => void;
  removeDevice: (id: string) => void;
  beginPlace: (deviceId: string) => void;
  cancelPlace: () => void;
  setNodeFilter: (p: Partial<NodeFilter>) => void;
  setNodeStatus: (deviceId: string, s: NodeStatus) => void;
  setAccess: (a: AccessSummaryDto | null) => void;
```
`initialViewportState` adds: `selection: null, devices: [], placingDeviceId: null, nodeFilter: emptyFilter(), nodeStatus: new Map(), access: null`. Implementations:
```typescript
  selectElement: (expressID) => set({ selection: { kind: 'element', expressID } }),
  selectNode: (deviceId) => set({ selection: { kind: 'device', deviceId } }),
  clearSelection: () => set({ selection: null }),
  setDevices: (devices) => set({ devices }),
  upsertDevice: (d) => set((s) => ({ devices: s.devices.some((x) => x.id === d.id) ? s.devices.map((x) => (x.id === d.id ? d : x)) : [...s.devices, d] })),
  removeDevice: (id) => set((s) => ({ devices: s.devices.filter((x) => x.id !== id), selection: s.selection?.kind === 'device' && s.selection.deviceId === id ? null : s.selection })),
  beginPlace: (placingDeviceId) => set({ placingDeviceId }),
  cancelPlace: () => set({ placingDeviceId: null }),
  setNodeFilter: (p) => set((s) => ({ nodeFilter: { ...s.nodeFilter, ...p } })),
  setNodeStatus: (id, st) => set((s) => { const n = new Map(s.nodeStatus); n.set(id, st); return { nodeStatus: n }; }),
  setAccess: (access) => set({ access }),
```
Also: `setActiveBuilding` (Spec 3) additionally resets node state: `devices: [], selection: null, placingDeviceId: null`.

- [ ] **Step 3: Update Spec 3's selection consumers** to the union (keeps them green):
  - `interaction/picking.ts` `PickingController`: replace `s.select(id)` with `id != null ? s.selectElement(id) : s.clearSelection()`.
  - `scene/apply-model-state.ts`: the highlight test becomes `id === (s.selection?.kind === 'element' ? s.selection.expressID : null)`. Update `ModelViewState.selection` type to `Selection` and `ModelView`'s store reads accordingly.
  - `ui/Inspector.tsx`: read `selection`; render the element branch only when `selection?.kind === 'element'` (call `model.getProperties(selection.expressID)`); `kind === 'device'` renders `null` for now (Phase D adds `DeviceDetails`). Update the Phase C/D Spec 3 inspector test to set `selection: { kind: 'element', expressID: 5 }`.

- [ ] **Step 4: Run → PASS** (new store test + the updated Spec 3 picking/apply-model-state/inspector tests). Commit `refactor(desktop): tagged element|device selection + viewport node state`.

---

## Task 6: Phase gate

- [ ] **Step 1: Suites.** `cd apps/desktop && npm test -- viewport stores` (green) and `cd apps/api && npm run test:integration -- devices` (green).
- [ ] **Step 2: Typecheck.** `cd apps/desktop && npx tsc --noEmit` → PASS.
- [ ] **Step 3: Docs (Rule 10).** Note in `apps/desktop/README.md` the `node-coords` bridge + the tagged selection; register `?buildingPropertyId` on `GET /v1/devices` in the API Design Document.
- [ ] **Step 4: Commit** `docs: record Spec 4 foundations (Phase A)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** `node-coords` `toViewport`/`toModel` (§5, §11) ✓ Task 1; `NodeStatus`+colour seam type (§9) ✓ Task 2; `filterDevices` all dimensions (§7) ✓ Task 2; `canConfigure` role gate (§8) ✓ Task 2; building-subtree, scope-filtered device list (§10) ✓ Tasks 3–4; `setDevicePosition` (§10) ✓ Task 4; store node-state + tagged selection refactor (§4, §7) ✓ Task 5.
- **Deferred (correctly NOT here):** markers/`NodeLayer`, device-load hook + realtime wiring, node picking (Phase B); `PlacementController` + affordance gating in UI (Phase C); Node panel + `DeviceDetails` + status filter UI (Phase D).
- **Placeholder scan:** none — complete code/commands. Inspector's `device` branch returning `null` is a stated Phase-D boundary.
- **Type consistency:** `Selection` union, `NodeFilter`/`emptyFilter`, `NodeStatus`/`STATUS_COLOR`, `canConfigure(access)`, `toViewport`/`toModel`, and the store actions (`selectNode`/`selectElement`/`setDevices`/`upsertDevice`/`removeDevice`/`beginPlace`/`cancelPlace`/`setNodeFilter`/`setNodeStatus`/`setAccess`) are the exact symbols Phases B/C/D import. `listDevicesForBuilding`/`setDevicePosition` are the client surface B/C use. `DeviceDto` is the post-Spec1/F2 shape (`x/y/z`, `propertyId`, `networkId`).
- **Test-config compliance:** `node-coords` is node; helper/store specs are environment-agnostic; the server filter is a Jest integration test on the test DB; client specs mock `fetch`. No r3f/WebGL here.
- **Integration points to verify during execution:** `PropertiesService.subtreePropertyIds` + F3 `scopeFilter` signatures (planned); the device controller's existing list path + `@CurrentMember`/`@OrgId` decorators; that the REST client exposes `get`/`patch` envelope helpers (+ an injectable `fetchImpl` for tests); `AccessSummaryDto.role` value set (`OWNER`/`ADMIN`/`MEMBER`).
