# Spec 7 Phase B — Read APIs, Scoped Realtime & Spec 4 Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose F3-scoped status reads (`GET …/device-status`, `GET …/metrics`), bind the `v1:device:status` emit to the realtime gateway's scoped fan-out, add the `@nodescope/client` methods, and wire it all into Spec 4's `useDeviceLoad` so markers/panel/filters light up live.

**Architecture:** `MonitoringService` reuses Spec 4's `DevicesService.listForBuilding` (subtree + F3 scope) for the device set, then maps `MonitoringRepository.listStatus` into `DeviceStatusDto[]` (missing rows → `UNKNOWN`). A `MonitoringGatewayEmitter` adapts Phase A's `MONITORING_EMITTER` port to the gateway's F3-scoped device-event helper. The desktop `useDeviceLoad` fetches initial status on building load and subscribes to `v1:device:status`, mapping `DeviceStatusState → NodeStatus` into `setNodeStatus`.

**Tech Stack:** NestJS 11, Prisma 5, TimescaleDB, Jest (e2e); React/Zustand, Vitest; `@nodescope/client`.

**Depends on:**
- **Phase A** — `MonitoringRepository`, `IngestService`, `MONITORING_EMITTER`/`MonitoringEmitter`, `DeviceStatusDto`, `WS_EVENTS.DEVICE_STATUS`.
- **Spec 4** — `DevicesService.listForBuilding` (Spec 4 Phase A), the desktop `useDeviceLoad`/`applyDeviceEvent` (Spec 4 Phase B), `viewportStore.setNodeStatus`, `NodeStatus`.
- **F3** — `PermissionsService` (`scopeFilter`, `assertCanView`), the gateway's scoped device-event emit (§8).
- Spec: `2026-06-11-spec7-device-monitoring-design.md` (§9, §10, §11).

---

## File Structure

**Create:**
- `apps/api/src/monitoring/status/monitoring.service.ts` — read logic (scoped)
- `apps/api/src/monitoring/status/monitoring.controller.ts` — `device-status` + `metrics`
- `apps/api/src/monitoring/ingest/monitoring-gateway.emitter.ts` — `MONITORING_EMITTER` adapter
- tests: `monitoring/__tests__/{monitoring.controller.e2e.ts, monitoring-gateway.emitter.spec.ts}`

**Modify:**
- `apps/api/src/monitoring/monitoring.module.ts` — bind the emitter + register the controller/service
- `packages/client/src/rest-client.ts` — `getBuildingDeviceStatus`, `getDeviceMetrics`
- `apps/desktop/src/renderer/viewport/use-device-load.ts` — initial status fetch + `v1:device:status` subscription
- `apps/desktop/src/renderer/viewport/nodes/node-status.ts` — `statusFromState` map

---

## Task 1: Gateway emitter adapter (Jest unit)

**Files:** Create `ingest/monitoring-gateway.emitter.ts`; modify `monitoring.module.ts`; test `monitoring/__tests__/monitoring-gateway.emitter.spec.ts`.

- [ ] **Step 1: Failing test** — the adapter forwards to the gateway's scoped device-event emit with the `v1:device:status` event:

```typescript
import { MonitoringGatewayEmitter } from '../ingest/monitoring-gateway.emitter';
import { WS_EVENTS } from '@nodescope/shared';

describe('MonitoringGatewayEmitter', () => {
  it('emits a scoped device-status event', () => {
    const gateway = { emitDeviceScoped: jest.fn() } as any;
    new MonitoringGatewayEmitter(gateway).emitDeviceStatus({ organizationId: 'o', deviceId: 'd', governingSiteId: 'p', state: 'DOWN', latencyMs: null, at: 't' });
    expect(gateway.emitDeviceScoped).toHaveBeenCalledWith('o', 'p', WS_EVENTS.DEVICE_STATUS, { deviceId: 'd', state: 'DOWN', latencyMs: null, at: 't' });
  });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `ingest/monitoring-gateway.emitter.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { WS_EVENTS } from '@nodescope/shared';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { MonitoringEmitter } from './ingest.service';

@Injectable()
export class MonitoringGatewayEmitter implements MonitoringEmitter {
  constructor(private readonly gateway: RealtimeGateway) {}
  emitDeviceStatus(p: { organizationId: string; deviceId: string; governingSiteId: string; state: string; latencyMs: number | null; at: string }): void {
    // emitDeviceScoped fans out to org:{org} filtered to sockets in-scope of governingSiteId (F3 §8)
    this.gateway.emitDeviceScoped(p.organizationId, p.governingSiteId, WS_EVENTS.DEVICE_STATUS, { deviceId: p.deviceId, state: p.state, latencyMs: p.latencyMs, at: p.at });
  }
}
```
In `monitoring.module.ts`, bind `{ provide: MONITORING_EMITTER, useClass: MonitoringGatewayEmitter }` and import the realtime module. (Verify the gateway's actual scoped-emit method name — `emitDeviceScoped` here — against F3's implementation; adjust the one call site if different.)

- [ ] **Step 3: Run → PASS.** Commit `feat(api): bind v1:device:status to the scoped realtime gateway`.

---

## Task 2: Read APIs — device-status + metrics (Jest e2e)

**Files:** Create `status/monitoring.service.ts`, `status/monitoring.controller.ts`; modify `monitoring.module.ts`; test `monitoring/__tests__/monitoring.controller.e2e.ts`.

- [ ] **Step 1: Failing e2e** — building device-status is scope-filtered and defaults to UNKNOWN:

```typescript
// seeds: org, a building with two devices (one with a DeviceStatus row UP, one without);
// an ADMIN scoped to the building. GET returns both, the unstatused one as UNKNOWN.
it('GET /v1/buildings/:id/device-status returns scoped statuses (UNKNOWN default)', async () => {
  const res = await request(app.getHttpServer()).get(`/v1/buildings/${buildingId}/device-status`).set(adminAuth).expect(200);
  const byId = Object.fromEntries(res.body.data.map((s: any) => [s.deviceId, s.state]));
  expect(byId[placedDeviceId]).toBe('UP');
  expect(byId[unstatusedDeviceId]).toBe('UNKNOWN');
});
it('a member outside the building scope gets none of its statuses', async () => {
  const res = await request(app.getHttpServer()).get(`/v1/buildings/${buildingId}/device-status`).set(outOfScopeAuth).expect(200);
  expect(res.body.data).toEqual([]);
});
```

- [ ] **Step 2: Run → FAIL**, then implement `status/monitoring.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { DeviceStatusDto } from '@nodescope/shared';
import { DevicesService } from '../../devices/devices.service';
import { MonitoringRepository } from '../monitoring.repository';
import { PermissionsService } from '../../permissions/permissions.service'; // F3
import type { Member } from '../../common/types'; // session member

const toDto = (deviceId: string, s: { state: string; latencyMs: number | null; lastCheckAt: Date | null; lastOkAt: Date | null; lastChangeAt: Date | null } | undefined): DeviceStatusDto => ({
  deviceId, state: (s?.state as any) ?? 'UNKNOWN', latencyMs: s?.latencyMs ?? null,
  lastCheckAt: s?.lastCheckAt?.toISOString() ?? null, lastOkAt: s?.lastOkAt?.toISOString() ?? null, lastChangeAt: s?.lastChangeAt?.toISOString() ?? null,
});

@Injectable()
export class MonitoringService {
  constructor(private readonly devices: DevicesService, private readonly repo: MonitoringRepository, private readonly permissions: PermissionsService) {}

  async getBuildingDeviceStatus(orgId: string, member: Member, buildingPropertyId: string): Promise<DeviceStatusDto[]> {
    const devices = await this.devices.listForBuilding(orgId, member, buildingPropertyId); // Spec 4: subtree + F3 scope
    const statuses = await this.repo.listStatus(orgId, devices.map((d) => d.id));
    const byId = new Map(statuses.map((s) => [s.deviceId, s]));
    return devices.map((d) => toDto(d.id, byId.get(d.id) as any));
  }

  async getDeviceMetrics(orgId: string, member: Member, deviceId: string, metric: string, from: Date, to: Date, bucket: string) {
    await this.permissions.assertCanView(member, { type: 'Device', id: deviceId }); // F3 → 404 if out of scope
    return this.repo.queryMetric(orgId, deviceId, metric, from, to, bucket);
  }
}
```
`status/monitoring.controller.ts`:
```typescript
@Controller('v1')
export class MonitoringController {
  constructor(private readonly svc: MonitoringService) {}
  @Get('buildings/:propertyId/device-status')
  status(@OrgId() orgId: string, @CurrentMember() m: Member, @Param('propertyId') propertyId: string) {
    return this.svc.getBuildingDeviceStatus(orgId, m, propertyId);
  }
  @Get('devices/:id/metrics')
  metrics(@OrgId() orgId: string, @CurrentMember() m: Member, @Param('id') id: string,
          @Query('metric') metric: string, @Query('from') from: string, @Query('to') to: string, @Query('bucket') bucket = '5 minutes') {
    return this.svc.getDeviceMetrics(orgId, m, id, metric, new Date(from), new Date(to), bucket);
  }
}
```
Register both in `monitoring.module.ts` (import `DevicesModule`, `PermissionsModule`).

- [ ] **Step 3: Run → PASS.** Commit `feat(api): scoped device-status + metrics read APIs`.

---

## Task 3: `@nodescope/client` status methods (Vitest)

**Files:** Modify `packages/client/src/rest-client.ts`; test `packages/client/src/__tests__/monitoring.spec.ts`.

- [ ] **Step 1: Failing test** (mocked fetch): `getBuildingDeviceStatus` hits the endpoint + unwraps.

```typescript
it('getBuildingDeviceStatus GETs the building endpoint', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: [{ deviceId: 'd', state: 'UP' }], timestamp: '' }) });
  const c = createRestClient({ baseUrl: 'http://x/api', getToken: async () => 't', fetchImpl: fetchMock });
  expect(await c.getBuildingDeviceStatus('b')).toEqual([{ deviceId: 'd', state: 'UP' }]);
  expect(fetchMock.mock.calls[0][0]).toContain('/v1/buildings/b/device-status');
});
```

- [ ] **Step 2: Run → FAIL**, then add to the REST client:

```typescript
getBuildingDeviceStatus(propertyId: string): Promise<DeviceStatusDto[]> {
  return this.get(`/v1/buildings/${encodeURIComponent(propertyId)}/device-status`);
}
getDeviceMetrics(id: string, metric: string, from: string, to: string, bucket = '5 minutes'): Promise<{ bucket: string; avg: number }[]> {
  return this.get(`/v1/devices/${id}/metrics?metric=${encodeURIComponent(metric)}&from=${from}&to=${to}&bucket=${encodeURIComponent(bucket)}`);
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(client): getBuildingDeviceStatus + getDeviceMetrics`.

---

## Task 4: Spec 4 wiring — `useDeviceLoad` consumes status (Vitest)

**Files:** Modify `apps/desktop/src/renderer/viewport/nodes/node-status.ts`, `viewport/use-device-load.ts`; test `viewport/__tests__/use-device-load-status.spec.ts`.

- [ ] **Step 1: `statusFromState`** in `nodes/node-status.ts`:

```typescript
import type { DeviceStatusState } from '@nodescope/shared';
export function statusFromState(state: DeviceStatusState): NodeStatus {
  return ({ UP: 'up', DOWN: 'down', WARNING: 'warning', UNKNOWN: 'unknown' } as const)[state];
}
```

- [ ] **Step 2: Failing test** `viewport/__tests__/use-device-load-status.spec.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { applyStatusEvent, loadStatusFor } from '../use-device-load';
import { useViewportStore, initialViewportState } from '../../stores/viewport-store';

beforeEach(() => useViewportStore.setState(initialViewportState(), true));

describe('status wiring', () => {
  it('loadStatusFor seeds nodeStatus from the API', async () => {
    const rest = { getBuildingDeviceStatus: async () => [{ deviceId: 'a', state: 'DOWN' }, { deviceId: 'b', state: 'UP' }] };
    await loadStatusFor('bld', rest as any, () => true);
    expect(useViewportStore.getState().nodeStatus.get('a')).toBe('down');
    expect(useViewportStore.getState().nodeStatus.get('b')).toBe('up');
  });
  it('applyStatusEvent maps a realtime event to NodeStatus', () => {
    applyStatusEvent({ deviceId: 'a', state: 'WARNING' });
    expect(useViewportStore.getState().nodeStatus.get('a')).toBe('warning');
  });
});
```

- [ ] **Step 3: Run → FAIL**, then extend `use-device-load.ts`:

```typescript
import { statusFromState } from './nodes/node-status';
import type { DeviceStatusState } from '@nodescope/shared';

export async function loadStatusFor(propertyId: string, rest: { getBuildingDeviceStatus(id: string): Promise<{ deviceId: string; state: DeviceStatusState }[]> }, isCurrent: () => boolean): Promise<void> {
  try {
    const rows = await rest.getBuildingDeviceStatus(propertyId);
    if (!isCurrent()) return;
    const store = useViewportStore.getState();
    for (const r of rows) store.setNodeStatus(r.deviceId, statusFromState(r.state));
  } catch { /* status is best-effort; markers stay 'unknown' */ }
}

export function applyStatusEvent(p: { deviceId: string; state: DeviceStatusState }): void {
  useViewportStore.getState().setNodeStatus(p.deviceId, statusFromState(p.state));
}
```
In `useDeviceLoad`: after `loadDevicesFor`, also call `loadStatusFor(propertyId, rest, …)`; in the realtime effect, add `rt.on(WS_EVENTS.DEVICE_STATUS, applyStatusEvent)` (+ `off` in cleanup).

- [ ] **Step 4: Run → PASS.** Commit `feat(desktop): consume device status into node markers (fills Spec 4 seam)`.

---

## Task 5: Phase gate

- [ ] **Step 1: Suites.** `cd apps/api && npm run test:integration -- monitoring && npm run test:e2e -- monitoring` and `cd apps/desktop && npm test -- use-device-load` → green.
- [ ] **Step 2: Typecheck.** both `npx tsc --noEmit` → PASS.
- [ ] **Step 3: Manual smoke (after Phase C or via a seeded ingest):** with some `DeviceStatus` rows, open a building in the desktop → markers/panel show the real status colors; flip a device to DOWN (ingest) → its marker turns red live via `v1:device:status`.
- [ ] **Step 4: Docs (Rule 10).** API Design Document: the `device-status` + `metrics` endpoints; note Spec 4's panel now reflects live status.
- [ ] **Step 5: Commit** `docs: record Spec 7 read APIs + Spec 4 status wiring (Phase B)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** scoped `device-status` read (§9, §10) ✓ Task 2; `metrics` time-series read (§10) ✓ Task 2; `v1:device:status` bound to the F3-scoped gateway (§9) ✓ Task 1; Spec 4 wiring — client + `useDeviceLoad` fetch + subscription → `setNodeStatus` (§9, §11) ✓ Tasks 3–4; `DeviceStatusState → NodeStatus` mapping (§9) ✓ Task 4.
- **Deferred (correctly NOT here):** the embedded prober (Phase C); HTTP ingest + token guard + token-gen (Phase D). The write pipeline + model are Phase A.
- **Placeholder scan:** none — concrete code/commands.
- **Type consistency:** `MonitoringService` reuses Spec 4's `DevicesService.listForBuilding`; `MonitoringRepository.listStatus`/`queryMetric` from Phase A; `MonitoringGatewayEmitter` implements Phase A's `MonitoringEmitter` and binds `MONITORING_EMITTER`; `DeviceStatusDto`/`WS_EVENTS.DEVICE_STATUS` from Phase A; `statusFromState` ↔ Spec 4 `NodeStatus`/`setNodeStatus`; client `getBuildingDeviceStatus` ↔ `loadStatusFor`.
- **Test-config compliance:** api e2e (real DB + the auth header helpers from F1a/F3 e2e), unit for the emitter; desktop Vitest with a mocked rest/store; client mocks `fetch`.
- **Integration points to verify during execution:** the gateway's real scoped-emit method name + signature; `DevicesService.listForBuilding` return shape (Spec 4 Phase A); `PermissionsService.assertCanView` entity arg shape (F3); the e2e auth/seed helpers (F3 scoped-admin/member fixtures).
