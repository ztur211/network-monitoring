# Spec 7 Phase D — HTTP Ingest & Token Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the agent-agnostic ingest over HTTP — `POST /v1/monitoring/ingest` (batch status checks + metrics) authed by a per-org **ingest token**, plus an OWNER `POST /v1/monitoring/ingest-token` to (re)generate it. This is the seam the future Agent (and any external pusher) targets; the payload routes through Phase A's `IngestService`.

**Architecture:** `IngestTokenService` mints a random secret, stores its sha256, and resolves a presented token → `organizationId`. `IngestTokenGuard` authenticates the ingest endpoint by token (not a user session) and attaches the org. The controller fans the batch into `IngestService.reportStatusCheck`/`reportMetric`; per-item org validation (`ORG_008`) is already enforced there.

**Tech Stack:** NestJS 11, Prisma 5, Node `crypto`, Jest (integration + e2e).

**Depends on:**
- **Phase A** — `IngestService`, `MonitoringIngestToken` model.
- **F1a** — `@OrgId()`, `@OrgRoles('OWNER')`, the `{ success, data }` envelope, `NodeScopeException`.
- Spec: `2026-06-11-spec7-device-monitoring-design.md` (§6, §10, §11, §12).

> Final Spec 7 phase. The **Agent spec** consumes this endpoint + token (enrollment/rotation lifecycle is the Agent's). Ends with the cross-plan review over A–D.

---

## File Structure

**Create:**
- `apps/api/src/monitoring/ingest/ingest-token.service.ts`
- `apps/api/src/monitoring/ingest/ingest-token.guard.ts`
- `apps/api/src/monitoring/ingest/ingest.controller.ts`
- tests `monitoring/__tests__/{ingest-token.service.spec.ts, ingest.controller.e2e.ts}`

**Modify:**
- `apps/api/src/monitoring/monitoring.module.ts` — provide the token service/guard + register the controller
- `packages/shared/src/types/api.types.ts` — `StatusCheckDto`, `MetricSampleDto`, `IngestBatchDto`

---

## Task 1: `IngestTokenService` (Jest integration)

**Files:** Create `ingest/ingest-token.service.ts`; test `monitoring/__tests__/ingest-token.service.spec.ts`.

- [ ] **Step 1: Failing test:**

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { IngestTokenService } from '../ingest/ingest-token.service';

describe('IngestTokenService (integration)', () => {
  let svc: IngestTokenService; let prisma: PrismaService; let orgId: string;
  beforeAll(async () => {
    const ref = await Test.createTestingModule({ providers: [IngestTokenService, PrismaService] }).compile();
    svc = ref.get(IngestTokenService); prisma = ref.get(PrismaService); await prisma.$connect();
  });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { orgId = (await prisma.organization.create({ data: { name: `T${Date.now()}` } })).id; });
  afterEach(async () => { await prisma.organization.delete({ where: { id: orgId } }); });

  it('mints a token that verifies back to the org; rotation invalidates the old one', async () => {
    const t1 = await svc.createOrRotate(orgId);
    expect(await svc.verify(t1)).toBe(orgId);
    const t2 = await svc.createOrRotate(orgId);
    expect(await svc.verify(t2)).toBe(orgId);
    expect(await svc.verify(t1)).toBeNull();   // old token no longer valid
    expect(await svc.verify('garbage')).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:integration -- ingest-token.service`.

- [ ] **Step 3: Implement `ingest/ingest-token.service.ts`:**

```typescript
import { Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class IngestTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async createOrRotate(organizationId: string): Promise<string> {
    const secret = randomBytes(32).toString('base64url');
    const tokenHash = hash(secret);
    await this.prisma.monitoringIngestToken.upsert({
      where: { organizationId }, create: { organizationId, tokenHash }, update: { tokenHash },
    });
    return secret; // shown once; only the hash is stored
  }

  async verify(token: string): Promise<string | null> {
    if (!token) return null;
    const row = await this.prisma.monitoringIngestToken.findFirst({ where: { tokenHash: hash(token) }, select: { organizationId: true } });
    return row?.organizationId ?? null;
  }
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): monitoring ingest-token service (hash + verify + rotate)`.

---

## Task 2: `IngestTokenGuard` (Jest unit)

**Files:** Create `ingest/ingest-token.guard.ts`; test `monitoring/__tests__/ingest-token.guard.spec.ts`.

- [ ] **Step 1: Failing test:**

```typescript
import { UnauthorizedException } from '@nestjs/common';
import { IngestTokenGuard } from '../ingest/ingest-token.guard';

const ctx = (headers: Record<string, string>) => ({ switchToHttp: () => ({ getRequest: () => ({ headers, ingestOrgId: undefined as string | undefined }) }) }) as any;

describe('IngestTokenGuard', () => {
  it('accepts a valid token and attaches the org', async () => {
    const guard = new IngestTokenGuard({ verify: async () => 'org-1' } as any);
    const c = ctx({ 'x-ingest-token': 'good' });
    expect(await guard.canActivate(c)).toBe(true);
    expect(c.switchToHttp().getRequest().ingestOrgId).toBe('org-1');
  });
  it('rejects a missing or invalid token', async () => {
    const guard = new IngestTokenGuard({ verify: async () => null } as any);
    await expect(guard.canActivate(ctx({}))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(ctx({ 'x-ingest-token': 'bad' }))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```
*(The guard reads a fresh request each call; in the unit test reuse the same `ctx` object so the mutation is observable.)*

- [ ] **Step 2: Run → FAIL**, then implement `ingest/ingest-token.guard.ts`:

```typescript
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { IngestTokenService } from './ingest-token.service';

@Injectable()
export class IngestTokenGuard implements CanActivate {
  constructor(private readonly tokens: IngestTokenService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header = req.headers['x-ingest-token'] as string | undefined;
    const bearer = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer\s+/i, '');
    const token = header ?? bearer ?? '';
    const orgId = await this.tokens.verify(token);
    if (!orgId) throw new UnauthorizedException('Invalid ingest token');
    req.ingestOrgId = orgId;
    return true;
  }
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(api): ingest-token guard`.

---

## Task 3: `IngestController` — `/ingest` + `/ingest-token` (Jest e2e)

**Files:** Create `ingest/ingest.controller.ts`; modify `monitoring.module.ts`, `packages/shared/src/types/api.types.ts`; test `monitoring/__tests__/ingest.controller.e2e.ts`.

- [ ] **Step 1: Shared DTOs** in `api.types.ts`:

```typescript
export interface StatusCheckDto { deviceId: string; ok: boolean; latencyMs?: number; source?: string; }
export interface MetricSampleDto { deviceId: string; metric: string; value: number; ts?: string; source?: string; }
export interface IngestBatchDto { checks?: StatusCheckDto[]; metrics?: MetricSampleDto[]; }
```
`cd packages/shared && npm run build`.

- [ ] **Step 2: Failing e2e** — token mints, ingest writes status, bad token 401, foreign device 404/`ORG_008`:

```typescript
it('OWNER mints a token, then an ingest with it sets device status', async () => {
  const { token } = (await request(app.getHttpServer()).post('/v1/monitoring/ingest-token').set(ownerAuth).expect(201)).body.data;
  await request(app.getHttpServer()).post('/v1/monitoring/ingest')
    .set('x-ingest-token', token).send({ checks: [{ deviceId, ok: true, latencyMs: 9 }] }).expect(202);
  const s = await request(app.getHttpServer()).get(`/v1/buildings/${buildingId}/device-status`).set(ownerAuth).expect(200);
  expect(s.body.data.find((x: any) => x.deviceId === deviceId).state).toBe('UP');
});
it('rejects a bad token', () =>
  request(app.getHttpServer()).post('/v1/monitoring/ingest').set('x-ingest-token', 'nope').send({ checks: [] }).expect(401));
it('rejects a device from another org', async () => {
  const { token } = (await request(app.getHttpServer()).post('/v1/monitoring/ingest-token').set(ownerAuth).expect(201)).body.data;
  await request(app.getHttpServer()).post('/v1/monitoring/ingest')
    .set('x-ingest-token', token).send({ checks: [{ deviceId: foreignDeviceId, ok: true }] }).expect(404); // ORG_008
});
```

- [ ] **Step 3: Run → FAIL**, then implement `ingest/ingest.controller.ts`:

```typescript
import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { IngestBatchDto } from '@nodescope/shared';
import { IngestService } from './ingest.service';
import { IngestTokenService } from './ingest-token.service';
import { IngestTokenGuard } from './ingest-token.guard';
import { OrgId } from '../../common/decorators/org-id.decorator';      // F1a
import { OrgRoles } from '../../common/decorators/org-roles.decorator'; // F1a

@Controller('v1/monitoring')
export class IngestController {
  constructor(private readonly ingest: IngestService, private readonly tokens: IngestTokenService) {}

  @Post('ingest')
  @UseGuards(IngestTokenGuard)
  @HttpCode(202)
  async ingestBatch(@Req() req: { ingestOrgId: string }, @Body() body: IngestBatchDto) {
    const organizationId = req.ingestOrgId;
    for (const c of body.checks ?? [])
      await this.ingest.reportStatusCheck({ organizationId, deviceId: c.deviceId, ok: c.ok, latencyMs: c.latencyMs, source: c.source ?? 'agent' });
    for (const m of body.metrics ?? [])
      await this.ingest.reportMetric({ organizationId, deviceId: m.deviceId, metric: m.metric, value: m.value, source: m.source ?? 'agent', ts: m.ts ? new Date(m.ts) : undefined });
    return { accepted: (body.checks?.length ?? 0) + (body.metrics?.length ?? 0) };
  }

  @Post('ingest-token')
  @OrgRoles('OWNER')
  async rotateToken(@OrgId() organizationId: string) {
    return { token: await this.tokens.createOrRotate(organizationId) };
  }
}
```
Register `IngestController` + `IngestTokenService`/`IngestTokenGuard` in `monitoring.module.ts`. (A bad `deviceId` makes `reportStatusCheck` throw `ORG_008` → the batch fails; per-item error collection is a §15 refinement.)

- [ ] **Step 4: Run → PASS.** Commit `feat(api): monitoring HTTP ingest + token endpoints`.

---

## Task 4: Phase gate

- [ ] **Step 1: Suites.** `cd apps/api && npm run test:integration -- monitoring && npm run test:e2e -- ingest` → green; full `npm run test:unit` green.
- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` → PASS.
- [ ] **Step 3: Manual smoke:** OWNER calls `POST /v1/monitoring/ingest-token` → a secret (once); `curl -H "x-ingest-token: …" -d '{"checks":[{"deviceId":"…","ok":false}]}' …/ingest` → the device flips `DOWN` and the desktop marker turns red live.
- [ ] **Step 4: Docs (Rule 10).** API Design Document: `POST /v1/monitoring/ingest` (token auth, batch shape) + `POST /v1/monitoring/ingest-token` (OWNER); note the token is shown once. SAD/CLAUDE.md: the Agent (next spec) pushes here.
- [ ] **Step 5: Commit** `docs: record Spec 7 HTTP ingest + token (Phase D) + pipeline complete`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** token-authed `POST /v1/monitoring/ingest` (§6, §10) ✓ Task 3; per-org ingest token mint/verify/rotate (§5, §6, §12) ✓ Task 1; token guard resolves org, not a session (§6, §12) ✓ Task 2; OWNER `POST /ingest-token` (§10) ✓ Task 3; batch routes through `IngestService` with per-item `ORG_008` (§6, §12) ✓ Task 3; `IngestBatchDto`/`StatusCheckDto`/`MetricSampleDto` (§11) ✓ Task 3.
- **Deferred (correctly per spec):** Agent enrollment/rotation lifecycle, SNMP, offline buffering, installers → the Agent spec; per-item batch error collection (one bad device fails the batch in v1) → §15.
- **Placeholder scan:** none — concrete code/commands.
- **Type consistency:** `IngestTokenService.createOrRotate`/`verify` ↔ guard ↔ controller; `IngestBatchDto` fans into Phase A `IngestService.reportStatusCheck`/`reportMetric` (exact arg shapes); `MonitoringIngestToken` model from Phase A; `@OrgId`/`@OrgRoles` from F1a.
- **Test-config compliance:** token service integration (real DB); guard unit (mocked service); controller e2e (real app, the F1a OWNER auth helper + an `x-ingest-token` header).
- **Integration points to verify during execution:** the F1a `@OrgRoles`/`@OrgId` decorator import paths; that `reportStatusCheck` throws `ORG_008` as a 404 (Phase A); request-object mutation (`req.ingestOrgId`) is visible to the handler under the app's adapter (Express/Fastify).

---

# Spec 7 — cross-plan self-review (all four phases)

- **Spec coverage (full):** §4 architecture (4 layers, in-API prober) → A (ingest/storage) + B (reads/realtime) + C (prober) ✓ · §5 data model (`DeviceStatus`, `MonitoringIngestToken`, two hypertables) → A ✓ · §6 ingest seam (`reportStatusCheck`/`reportMetric` + HTTP + token) → A (service) + D (HTTP/token) ✓ · §7 derivation → A ✓ · §8 embedded ICMP+TCP prober, off by default → C ✓ · §9 F3-scoped reads + `v1:device:status` → Spec 4 → B ✓ · §10 read APIs + token endpoint → B + D ✓ · §11 public interface (ingest seam, token, status/metric contracts) → A/B/D, exported for the Agent ✓ · §12 security (token-not-session, org validation, scope parity, opt-in prober) → A/B/D ✓ · §13 testing (unit derivation/probe/guard; integration repo/ingest/token; e2e reads/ingest/realtime) → every phase ✓.
- **Build-green order:** A (model + write pipeline + emit) → B (reads + gateway emitter + Spec 4 wiring) → C (embedded prober feeds A) → D (HTTP ingest + token). Each ends green; nothing earlier imports a later phase. B finalizes A's deferred `MONITORING_EMITTER` binding (stated in both).
- **Cross-phase type consistency:** `IngestService.reportStatusCheck/reportMetric`, `MonitoringRepository`, `deriveState`, `MonitoringEmitter`/`MONITORING_EMITTER`, `DeviceStatusDto`, `WS_EVENTS.DEVICE_STATUS` (A) are consumed unchanged by B/C/D; `MonitoringService` reuses Spec 4's `DevicesService.listForBuilding`; `statusFromState` bridges to Spec 4's `NodeStatus`/`setNodeStatus`; `ProbeResult`→`reportStatusCheck`; `IngestBatchDto`→`IngestService`; `IngestTokenService` ↔ guard ↔ controller.
- **Flagged for execution:** the realtime gateway's scoped device-event emit method name (B Task 1); F3 `PermissionsService.assertCanView` + `scopeFilter` and `DevicesService.listForBuilding` signatures (B); the current `ChangeLog` CHECK contents (A); the `ping` binary/`NET_RAW` in the container (C); the app adapter's request mutation for the guard (D). All localized.
- **Boundary to the Agent spec:** it pushes to `POST /v1/monitoring/ingest` with the per-org token (`StatusCheckDto`/`MetricSampleDto` batch) and adds SNMP/rich metrics via the same `reportMetric` path — no server change. It owns enrollment, token rotation UX, offline buffering, and installers. No Spec 7 internal beyond §11 is part of that contract.
