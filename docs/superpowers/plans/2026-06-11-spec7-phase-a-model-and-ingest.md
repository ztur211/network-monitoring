# Spec 7 Phase A — Model, Timescale Storage & Ingest Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `DeviceStatus` model + `MonitoringIngestToken`, the two TimescaleDB hypertables (`DeviceMetric`, `DeviceStatusEvent`), the shared DTO + event, the pure state-derivation, the `MonitoringRepository`, and the `IngestService` write seam (`reportStatusCheck`/`reportMetric`) that derives state and emits `v1:device:status` on a transition. No HTTP, no prober, no read APIs yet.

**Architecture:** A new `monitoring` NestJS module. `DeviceStatus`/`MonitoringIngestToken` are Prisma models; `DeviceMetric`/`DeviceStatusEvent` are raw-SQL Timescale hypertables the repository accesses via `$queryRaw`/`$executeRaw` (Prisma doesn't manage them). `IngestService` is the single write path; it derives state with a pure `deriveState` and emits a transition event through the existing realtime gateway's F3-scoped device-event helper.

**Tech Stack:** NestJS 11, Prisma 5, **TimescaleDB** (`timescaledb-ha:pg16`), Jest (unit + integration on the test DB `:5433`).

**Depends on:**
- **F1a** — `Organization`, `ChangeLog` (+ its `entityType` CHECK), `PrismaService`, the realtime gateway + its **F3-scoped** device-event emit helper (§8).
- **F2/F3** — `Device.propertyId` (`governingSiteId`).
- Existing — `Device.ipAddress`, the TimescaleDB image already in compose.
- Spec: `docs/superpowers/specs/2026-06-11-spec7-device-monitoring-design.md` (§4–§7, §11).

> Additive. Read APIs (Phase B), the embedded prober (Phase C), and the HTTP ingest + token auth (Phase D) build on this.

---

## File Structure

**Create:**
- `apps/api/src/monitoring/monitoring.module.ts`
- `apps/api/src/monitoring/monitoring.repository.ts` — `DeviceStatus` (Prisma) + hypertable raw SQL
- `apps/api/src/monitoring/status/derive-state.ts` — pure `deriveState`
- `apps/api/src/monitoring/ingest/ingest.service.ts` — `reportStatusCheck` / `reportMetric`
- `apps/api/src/monitoring/__tests__/{derive-state.spec.ts, ingest.service.spec.ts, monitoring.repository.spec.ts}`

**Modify:**
- `apps/api/prisma/schema.prisma` — `DeviceStatus`, `DeviceStatusState`, `MonitoringIngestToken`, back-relations
- the generated migration `.sql` — TimescaleDB extension + the two hypertables + retention + `ChangeLog` CHECK
- `packages/shared/src/types/api.types.ts` — `DeviceStatusDto`, `DeviceStatusState`
- `packages/shared/src/types/realtime.types.ts` — `DEVICE_STATUS` event

---

## Task 1: Schema + Timescale hypertables (migration)

**Files:** `apps/api/prisma/schema.prisma`; the generated migration.

- [ ] **Step 1: Prisma models** (spec §5):

```prisma
enum DeviceStatusState { UP DOWN WARNING UNKNOWN }

model DeviceStatus {
  id               String            @id @default(uuid())
  organizationId   String
  deviceId         String            @unique
  state            DeviceStatusState @default(UNKNOWN)
  latencyMs        Float?
  consecutiveFails Int               @default(0)
  lastCheckAt      DateTime?
  lastOkAt         DateTime?
  lastChangeAt     DateTime?
  source           String?
  updatedAt        DateTime          @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  device       Device       @relation(fields: [deviceId], references: [id], onDelete: Cascade)

  @@index([organizationId])
}

model MonitoringIngestToken {
  id             String   @id @default(uuid())
  organizationId String   @unique
  tokenHash      String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
}
```
Back-relations on `Organization` (`deviceStatuses DeviceStatus[]`, `monitoringIngestToken MonitoringIngestToken?`) and `Device` (`status DeviceStatus?`).

- [ ] **Step 2: Generate the migration.** `cd apps/api && npx prisma migrate dev --name spec7_monitoring` → creates the `DeviceStatus`/`MonitoringIngestToken` tables.

- [ ] **Step 3: Append the Timescale hypertables + CHECK** to the generated `migration.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE "DeviceMetric" (
  "time" TIMESTAMPTZ NOT NULL,
  "organizationId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "source" TEXT
);
SELECT create_hypertable('"DeviceMetric"', 'time');
CREATE INDEX "device_metric_dev_metric_time" ON "DeviceMetric" ("deviceId", "metric", "time" DESC);
SELECT add_retention_policy('"DeviceMetric"', INTERVAL '90 days');

CREATE TABLE "DeviceStatusEvent" (
  "time" TIMESTAMPTZ NOT NULL,
  "organizationId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "source" TEXT
);
SELECT create_hypertable('"DeviceStatusEvent"', 'time');
CREATE INDEX "device_status_event_dev_time" ON "DeviceStatusEvent" ("deviceId", "time" DESC);
SELECT add_retention_policy('"DeviceStatusEvent"', INTERVAL '365 days');

ALTER TABLE "ChangeLog" DROP CONSTRAINT IF EXISTS "changelog_entity_type_check";
ALTER TABLE "ChangeLog" ADD CONSTRAINT "changelog_entity_type_check"
  CHECK ("entityType" IN ('Device','Circuit','FiberRun','DeviceConnection','Property','NetworkProperty',
                          'BuildingModel','BuildingModelVersion','Team','TeamMember','TeamProperty','MemberProperty',
                          'MonitoringIngestToken'));
```
(The CHECK list mirrors the prior specs' entity types + the new `MonitoringIngestToken`; reconcile with the actual current CHECK during execution.)

- [ ] **Step 4: Apply (greenfield).** `cd apps/api && npx prisma migrate reset --force` → migration applies, hypertables created. `npx tsc --noEmit` → PASS. **Commit** `feat(api): DeviceStatus + MonitoringIngestToken + Timescale hypertables`.

---

## Task 2: Shared DTO + WS event

**Files:** `packages/shared/src/types/api.types.ts`, `realtime.types.ts`.

- [ ] **Step 1: DTO + enum** in `api.types.ts`:

```typescript
export type DeviceStatusState = 'UP' | 'DOWN' | 'WARNING' | 'UNKNOWN';
export interface DeviceStatusDto {
  deviceId: string;
  state: DeviceStatusState;
  latencyMs: number | null;
  lastCheckAt: string | null;
  lastOkAt: string | null;
  lastChangeAt: string | null;
}
```

- [ ] **Step 2: WS event** in `realtime.types.ts` (`WS_EVENTS`): `DEVICE_STATUS: 'v1:device:status'`.

- [ ] **Step 3: Build.** `cd packages/shared && npm run build` → PASS. **Commit** `feat(shared): DeviceStatusDto + v1:device:status event`.

---

## Task 3: `deriveState` (Jest unit, pure)

**Files:** Create `monitoring/status/derive-state.ts`; test `monitoring/__tests__/derive-state.spec.ts`.

- [ ] **Step 1: Failing test:**

```typescript
import { deriveState, DeriveConfig } from '../status/derive-state';

const cfg: DeriveConfig = { downThreshold: 3, warnLatencyMs: 250 };

describe('deriveState', () => {
  it('UP on a fast ok check', () => {
    expect(deriveState({ consecutiveFails: 0 }, { ok: true, latencyMs: 10 }, cfg)).toEqual({ state: 'UP', consecutiveFails: 0 });
  });
  it('WARNING on a slow ok check', () => {
    expect(deriveState({ consecutiveFails: 0 }, { ok: true, latencyMs: 400 }, cfg).state).toBe('WARNING');
  });
  it('stays its prior non-DOWN state until the threshold, then DOWN', () => {
    expect(deriveState({ consecutiveFails: 1 }, { ok: false }, cfg)).toEqual({ state: 'WARNING', consecutiveFails: 2 }); // < threshold → not yet DOWN (keeps a "soft" warning)
    expect(deriveState({ consecutiveFails: 2 }, { ok: false }, cfg)).toEqual({ state: 'DOWN', consecutiveFails: 3 });
  });
  it('resets fails on recovery', () => {
    expect(deriveState({ consecutiveFails: 5 }, { ok: true, latencyMs: 10 }, cfg)).toEqual({ state: 'UP', consecutiveFails: 0 });
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:unit -- derive-state`.

- [ ] **Step 3: Implement `status/derive-state.ts`:**

```typescript
import { DeviceStatusState } from '@prisma/client';

export interface DeriveConfig { downThreshold: number; warnLatencyMs: number }
export interface DeriveInput { ok: boolean; latencyMs?: number }
export interface DerivePrev { consecutiveFails: number }
export interface DeriveResult { state: DeviceStatusState; consecutiveFails: number }

export function deriveState(prev: DerivePrev, check: DeriveInput, cfg: DeriveConfig): DeriveResult {
  if (check.ok) {
    const slow = (check.latencyMs ?? 0) > cfg.warnLatencyMs;
    return { state: slow ? 'WARNING' : 'UP', consecutiveFails: 0 };
  }
  const consecutiveFails = prev.consecutiveFails + 1;
  // below threshold a single miss is treated as a soft WARNING, not a hard DOWN (anti-flap)
  return { state: consecutiveFails >= cfg.downThreshold ? 'DOWN' : 'WARNING', consecutiveFails };
}
```
(`UNKNOWN` is set by the caller when there is no `ipAddress` or the check is stale — §7; `deriveState` covers checked devices.)

- [ ] **Step 4: Run → PASS.** Commit `feat(api): monitoring state derivation`.

---

## Task 4: `MonitoringRepository` (Jest integration)

**Files:** Create `monitoring/monitoring.repository.ts`; test `monitoring/__tests__/monitoring.repository.spec.ts`.

- [ ] **Step 1: Failing integration test** (real test DB; needs an org + device):

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { MonitoringRepository } from '../monitoring.repository';

describe('MonitoringRepository (integration)', () => {
  let repo: MonitoringRepository; let prisma: PrismaService; let orgId: string; let deviceId: string;
  beforeAll(async () => {
    const ref = await Test.createTestingModule({ providers: [MonitoringRepository, PrismaService] }).compile();
    repo = ref.get(MonitoringRepository); prisma = ref.get(PrismaService); await prisma.$connect();
  });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: `M${Date.now()}` } }); orgId = org.id;
    const net = await prisma.network.create({ data: { organizationId: orgId, name: 'N' } });
    const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'S' } });
    const dev = await prisma.device.create({ data: { organizationId: orgId, name: 'D', category: 'SWITCH', propertyId: site.id, networkId: net.id, ipAddress: '10.0.0.1' } });
    deviceId = dev.id;
  });
  afterEach(async () => { await prisma.organization.delete({ where: { id: orgId } }); });

  it('upserts status, inserts a metric + status event, reads back', async () => {
    await repo.upsertStatus({ organizationId: orgId, deviceId, state: 'UP', latencyMs: 12, consecutiveFails: 0, source: 'prober', ok: true });
    await repo.insertMetric({ organizationId: orgId, deviceId, metric: 'latency_ms', value: 12, source: 'prober' });
    await repo.insertStatusEvent({ organizationId: orgId, deviceId, state: 'UP', source: 'prober' });
    const s = await repo.getStatus(orgId, deviceId);
    expect(s?.state).toBe('UP'); expect(s?.latencyMs).toBe(12);
    const series = await repo.queryMetric(orgId, deviceId, 'latency_ms', new Date(Date.now() - 60000), new Date(), '1 minute');
    expect(series.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:integration -- monitoring.repository`.

- [ ] **Step 3: Implement `monitoring.repository.ts`:**

```typescript
import { Injectable } from '@nestjs/common';
import { DeviceStatus, DeviceStatusState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MonitoringRepository {
  constructor(private readonly prisma: PrismaService) {}

  getStatus(organizationId: string, deviceId: string): Promise<DeviceStatus | null> {
    return this.prisma.deviceStatus.findFirst({ where: { organizationId, deviceId } });
  }
  listStatus(organizationId: string, deviceIds: string[]): Promise<DeviceStatus[]> {
    return this.prisma.deviceStatus.findMany({ where: { organizationId, deviceId: { in: deviceIds } } });
  }
  async upsertStatus(d: { organizationId: string; deviceId: string; state: DeviceStatusState; latencyMs: number | null; consecutiveFails: number; source: string; ok: boolean; changed?: boolean }): Promise<void> {
    const now = new Date();
    await this.prisma.deviceStatus.upsert({
      where: { deviceId: d.deviceId },
      create: { organizationId: d.organizationId, deviceId: d.deviceId, state: d.state, latencyMs: d.latencyMs, consecutiveFails: d.consecutiveFails, source: d.source, lastCheckAt: now, lastOkAt: d.ok ? now : null, lastChangeAt: now },
      update: { state: d.state, latencyMs: d.latencyMs, consecutiveFails: d.consecutiveFails, source: d.source, lastCheckAt: now, ...(d.ok ? { lastOkAt: now } : {}), ...(d.changed ? { lastChangeAt: now } : {}) },
    });
  }
  insertMetric(d: { organizationId: string; deviceId: string; metric: string; value: number; source: string; ts?: Date }): Promise<unknown> {
    return this.prisma.$executeRaw`INSERT INTO "DeviceMetric" ("time","organizationId","deviceId","metric","value","source")
      VALUES (${d.ts ?? new Date()}, ${d.organizationId}, ${d.deviceId}, ${d.metric}, ${d.value}, ${d.source})`;
  }
  insertStatusEvent(d: { organizationId: string; deviceId: string; state: DeviceStatusState; source: string }): Promise<unknown> {
    return this.prisma.$executeRaw`INSERT INTO "DeviceStatusEvent" ("time","organizationId","deviceId","state","source")
      VALUES (${new Date()}, ${d.organizationId}, ${d.deviceId}, ${d.state}, ${d.source})`;
  }
  queryMetric(organizationId: string, deviceId: string, metric: string, from: Date, to: Date, bucket: string): Promise<{ bucket: Date; avg: number }[]> {
    return this.prisma.$queryRaw`SELECT time_bucket(${bucket}::interval, "time") AS bucket, avg("value")::float AS avg
      FROM "DeviceMetric" WHERE "organizationId" = ${organizationId} AND "deviceId" = ${deviceId} AND "metric" = ${metric}
      AND "time" >= ${from} AND "time" <= ${to} GROUP BY bucket ORDER BY bucket`;
  }
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): MonitoringRepository (status + Timescale metric/event)`.

---

## Task 5: `IngestService` write seam (Jest integration)

**Files:** Create `monitoring/ingest/ingest.service.ts`, `monitoring/monitoring.module.ts`; test `monitoring/__tests__/ingest.service.spec.ts`.

The realtime emit goes through the existing gateway's F3-scoped device-event helper, injected so tests can fake it.

- [ ] **Step 1: Failing integration test** — a transition emits, a same-state check does not:

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { MonitoringRepository } from '../monitoring.repository';
import { IngestService, MONITORING_EMITTER } from '../ingest/ingest.service';

describe('IngestService (integration)', () => {
  let svc: IngestService; let prisma: PrismaService; let orgId: string; let deviceId: string;
  const emit = jest.fn();
  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      providers: [IngestService, MonitoringRepository, PrismaService, { provide: MONITORING_EMITTER, useValue: { emitDeviceStatus: emit } }],
    }).compile();
    svc = ref.get(IngestService); prisma = ref.get(PrismaService); await prisma.$connect();
  });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    jest.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: `I${Date.now()}` } }); orgId = org.id;
    const net = await prisma.network.create({ data: { organizationId: orgId, name: 'N' } });
    const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'S' } });
    const dev = await prisma.device.create({ data: { organizationId: orgId, name: 'D', category: 'SWITCH', propertyId: site.id, networkId: net.id, ipAddress: '10.0.0.1' } });
    deviceId = dev.id;
  });
  afterEach(async () => { await prisma.organization.delete({ where: { id: orgId } }); });

  it('first ok check → UP + emits once; a second ok check does not re-emit', async () => {
    await svc.reportStatusCheck({ organizationId: orgId, deviceId, ok: true, latencyMs: 10, source: 'prober' });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({ deviceId, state: 'UP' });
    await svc.reportStatusCheck({ organizationId: orgId, deviceId, ok: true, latencyMs: 11, source: 'prober' });
    expect(emit).toHaveBeenCalledTimes(1); // no transition
  });
  it('rejects a device from another org', async () => {
    const other = await prisma.organization.create({ data: { name: `X${Date.now()}` } });
    await expect(svc.reportStatusCheck({ organizationId: other.id, deviceId, ok: true, latencyMs: 5, source: 'x' })).rejects.toThrow();
    await prisma.organization.delete({ where: { id: other.id } });
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:integration -- ingest.service`.

- [ ] **Step 3: Implement `ingest/ingest.service.ts`:**

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MonitoringRepository } from '../monitoring.repository';
import { deriveState } from '../status/derive-state';
import { NodeScopeException } from '../../common/errors/nodescope.exception'; // F1a

export const MONITORING_EMITTER = Symbol('MONITORING_EMITTER');
export interface MonitoringEmitter { emitDeviceStatus(payload: { organizationId: string; deviceId: string; governingSiteId: string; state: string; latencyMs: number | null; at: string }): void }

const cfg = () => ({ downThreshold: Number(process.env.MONITORING_DOWN_THRESHOLD ?? 3), warnLatencyMs: Number(process.env.MONITORING_WARN_LATENCY_MS ?? 250) });

@Injectable()
export class IngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: MonitoringRepository,
    @Inject(MONITORING_EMITTER) private readonly emitter: MonitoringEmitter,
  ) {}

  private async device(organizationId: string, deviceId: string) {
    const d = await this.prisma.device.findFirst({ where: { id: deviceId, organizationId }, select: { id: true, propertyId: true } });
    if (!d) throw new NodeScopeException('ORG_008', 'Device not in organization', 404);
    return d;
  }

  async reportStatusCheck(input: { organizationId: string; deviceId: string; ok: boolean; latencyMs?: number; source: string; checkedAt?: Date }): Promise<void> {
    const dev = await this.device(input.organizationId, input.deviceId);
    const prev = await this.repo.getStatus(input.organizationId, input.deviceId);
    const { state, consecutiveFails } = deriveState({ consecutiveFails: prev?.consecutiveFails ?? 0 }, { ok: input.ok, latencyMs: input.latencyMs }, cfg());
    const changed = prev?.state !== state;
    await this.repo.upsertStatus({ organizationId: input.organizationId, deviceId: input.deviceId, state, latencyMs: input.latencyMs ?? null, consecutiveFails, source: input.source, ok: input.ok, changed });
    if (input.latencyMs != null) await this.repo.insertMetric({ organizationId: input.organizationId, deviceId: input.deviceId, metric: 'latency_ms', value: input.latencyMs, source: input.source, ts: input.checkedAt });
    await this.repo.insertMetric({ organizationId: input.organizationId, deviceId: input.deviceId, metric: 'reachable', value: input.ok ? 1 : 0, source: input.source, ts: input.checkedAt });
    if (changed) {
      await this.repo.insertStatusEvent({ organizationId: input.organizationId, deviceId: input.deviceId, state, source: input.source });
      this.emitter.emitDeviceStatus({ organizationId: input.organizationId, deviceId: input.deviceId, governingSiteId: dev.propertyId, state, latencyMs: input.latencyMs ?? null, at: new Date().toISOString() });
    }
  }

  async reportMetric(input: { organizationId: string; deviceId: string; metric: string; value: number; source: string; ts?: Date }): Promise<void> {
    await this.device(input.organizationId, input.deviceId);
    await this.repo.insertMetric(input);
  }
}
```
`monitoring.module.ts` provides `MonitoringRepository`, `IngestService`, and binds `MONITORING_EMITTER` to a small adapter over the realtime gateway's scoped device-event emit (the real wiring lands with Phase B's realtime test; for now the module can bind a no-op emitter or the gateway adapter if available).

- [ ] **Step 4: Run → PASS.** Commit `feat(api): IngestService write seam (status check + metric + transition emit)`.

---

## Task 6: Phase gate

- [ ] **Step 1: Suite.** `docker compose -f docker-compose.test.yml up -d` then `cd apps/api && npm run test:unit && npm run test:integration -- monitoring` → green.
- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` → PASS.
- [ ] **Step 3: Docs (Rule 10).** Register `DeviceStatusState` + the `v1:device:status` event in the API Design Document; note the Timescale hypertables (`DeviceMetric`/`DeviceStatusEvent`) + retention in the SAD.
- [ ] **Step 4: Commit** `docs: record Spec 7 monitoring model + ingest pipeline (Phase A)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** `DeviceStatus` + hypertables (§5) ✓ Tasks 1, 4; ingest seam `reportStatusCheck`/`reportMetric` (§6) ✓ Task 5; state derivation (§7) ✓ Task 3; emit on transition only (§6, §9) ✓ Task 5; generic metric write (§6) ✓ Tasks 4–5; `MonitoringIngestToken` model (§5) ✓ Task 1; `DeviceStatusDto` + event (§11) ✓ Task 2.
- **Deferred (correctly NOT here):** read APIs + Spec 4 wiring (Phase B); embedded prober (Phase C); HTTP ingest + token guard + token-gen (Phase D — the model exists here, the endpoints don't).
- **Placeholder scan:** none — concrete code/commands. The emitter binding in `monitoring.module` is finalized against the gateway in Phase B (stated), with a typed `MONITORING_EMITTER` port here.
- **Type consistency:** `deriveState(prev, check, cfg)` ↔ `IngestService`; `MonitoringRepository` methods (`getStatus`/`listStatus`/`upsertStatus`/`insertMetric`/`insertStatusEvent`/`queryMetric`) are Phase B/C/D's surface; `MONITORING_EMITTER`/`MonitoringEmitter.emitDeviceStatus` is Phase B's gateway-adapter contract; `DeviceStatusState` from `@prisma/client` matches the shared union.
- **Test-config compliance:** `derive-state` unit (regex `*.spec.ts`); repository + ingest integration on the `:5433` test DB (Timescale image); the emitter is faked in unit/integration.
- **Integration points to verify during execution:** the realtime gateway's actual F3-scoped device-event emit signature (Phase B binds the adapter); the exact current `ChangeLog` CHECK contents to extend; `NodeScopeException` constructor/`ORG_008` shape; that the test DB image is `timescaledb-ha` (it is) so `create_hypertable` works.
