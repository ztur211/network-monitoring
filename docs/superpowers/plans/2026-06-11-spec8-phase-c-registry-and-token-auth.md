# Spec 8 Phase C — Agent Registry, Tokens & Ingest Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the server `Agent` + `AgentEnrollmentCode` models, the repository, the `AgentTokenService` (enroll → per-agent token; verify; generate enrollment code), the `AgentTokenGuard` (token → `{orgId, agentId}`, bumps `lastSeenAt`, rejects revoked), and extend Spec 7's ingest to accept a per-agent token (`source = agent:<id>`).

**Architecture:** Prisma models + `agent.repository`. `AgentTokenService` mints a random per-agent secret (sha256 stored), validates single-use enrollment codes, and resolves a token → agent. `AgentTokenGuard` authenticates agent-facing routes. Spec 7's ingest guard is widened to try the agent token first, then the org ingest token.

**Tech Stack:** NestJS 11, Prisma 5, Node `crypto`, Jest (unit + integration/e2e).

**Depends on:**
- **Phase A** — `AgentEnrollResponse` (shared).
- **Spec 7** — `IngestService`, `IngestTokenService`, `IngestTokenGuard` (to widen), `MonitoringIngestToken`.
- **F1a** — `PrismaService`, `NodeScopeException`, `Organization`, `OrganizationMember`.
- Spec: `docs/superpowers/specs/2026-06-11-spec8-agent-core-design.md` (§6, §9, §12).

> Agent-facing controllers + management endpoints + UI + installers + e2e are Phase D. This phase is the registry + auth plumbing.

---

## File Structure

**Create:**
- `apps/api/src/agents/agent.repository.ts`
- `apps/api/src/agents/agent-token.service.ts`
- `apps/api/src/agents/agent-token.guard.ts`
- tests `apps/api/src/agents/__tests__/{agent-token.service.spec.ts, agent-token.guard.spec.ts}`

**Modify:**
- `apps/api/prisma/schema.prisma` — `Agent`, `AgentEnrollmentCode`, `AgentStatus`
- the migration — tables + `ChangeLog` CHECK (`'Agent'`)
- `apps/api/src/monitoring/ingest/ingest-token.guard.ts` + `ingest.controller.ts` — accept the agent token

---

## Task 1: Models + migration

- [ ] **Step 1: Prisma** (spec §6):
```prisma
enum AgentStatus { PENDING APPROVED REVOKED }
model Agent {
  id String @id @default(uuid())
  organizationId String
  name String
  platform String?
  version String?
  status AgentStatus @default(APPROVED)
  lastSeenAt DateTime?
  tokenHash String @unique
  createdByMemberId String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@index([organizationId])
}
model AgentEnrollmentCode {
  id String @id @default(uuid())
  organizationId String
  codeHash String @unique
  expiresAt DateTime
  createdByMemberId String?
  usedAt DateTime?
  createdAt DateTime @default(now())
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@index([organizationId])
}
```
Back-relations `agents Agent[]` / `agentEnrollmentCodes AgentEnrollmentCode[]` on `Organization`.

- [ ] **Step 2: Migrate.** `cd apps/api && npx prisma migrate dev --name spec8_agents`. Append to the migration the `ChangeLog` CHECK extension adding `'Agent'` (mirror the current list). `npx prisma migrate reset --force`. `npx tsc --noEmit` → PASS. Commit `feat(api): Agent + AgentEnrollmentCode models`.

---

## Task 2: `agent.repository` (Jest integration)

**Files:** Create `agents/agent.repository.ts`; test `agents/__tests__/agent.repository.spec.ts`.

- [ ] **Step 1: Failing integration test:**
```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentRepository } from '../agent.repository';

describe('AgentRepository (integration)', () => {
  let repo: AgentRepository; let prisma: PrismaService; let orgId: string;
  beforeAll(async () => { const r = await Test.createTestingModule({ providers: [AgentRepository, PrismaService] }).compile(); repo = r.get(AgentRepository); prisma = r.get(PrismaService); await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { orgId = (await prisma.organization.create({ data: { name: `A${Date.now()}` } })).id; });
  afterEach(async () => { await prisma.organization.delete({ where: { id: orgId } }); });

  it('creates an agent, finds it by token hash, lists, touches last-seen, revokes', async () => {
    const a = await repo.create({ organizationId: orgId, name: 'edge', platform: 'linux', version: '0.0.0', tokenHash: 'h', createdByMemberId: null });
    expect((await repo.findByTokenHash('h'))?.id).toBe(a.id);
    expect((await repo.listByOrg(orgId)).map((x) => x.id)).toEqual([a.id]);
    await repo.touchLastSeen(a.id);
    expect((await repo.findById(a.id))?.lastSeenAt).not.toBeNull();
    await repo.setStatus(a.id, 'REVOKED');
    expect((await repo.findById(a.id))?.status).toBe('REVOKED');
  });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `agent.repository.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { Agent, AgentStatus, AgentEnrollmentCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AgentRepository {
  constructor(private readonly prisma: PrismaService) {}
  create(d: { organizationId: string; name: string; platform: string | null; version: string | null; tokenHash: string; createdByMemberId: string | null }): Promise<Agent> {
    return this.prisma.agent.create({ data: { ...d, status: 'APPROVED' } });
  }
  findById(id: string): Promise<Agent | null> { return this.prisma.agent.findUnique({ where: { id } }); }
  findByTokenHash(tokenHash: string): Promise<Agent | null> { return this.prisma.agent.findUnique({ where: { tokenHash } }); }
  listByOrg(organizationId: string): Promise<Agent[]> { return this.prisma.agent.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }); }
  touchLastSeen(id: string): Promise<unknown> { return this.prisma.agent.update({ where: { id }, data: { lastSeenAt: new Date() } }); }
  setStatus(id: string, status: AgentStatus): Promise<unknown> { return this.prisma.agent.update({ where: { id }, data: { status } }); }
  delete(id: string): Promise<unknown> { return this.prisma.agent.delete({ where: { id } }); }
  createCode(d: { organizationId: string; codeHash: string; expiresAt: Date; createdByMemberId: string | null }): Promise<AgentEnrollmentCode> { return this.prisma.agentEnrollmentCode.create({ data: d }); }
  findValidCode(codeHash: string): Promise<AgentEnrollmentCode | null> { return this.prisma.agentEnrollmentCode.findFirst({ where: { codeHash, usedAt: null, expiresAt: { gt: new Date() } } }); }
  markCodeUsed(id: string): Promise<unknown> { return this.prisma.agentEnrollmentCode.update({ where: { id }, data: { usedAt: new Date() } }); }
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(api): AgentRepository`.

---

## Task 3: `AgentTokenService` (Jest integration)

**Files:** Create `agents/agent-token.service.ts`; test `agents/__tests__/agent-token.service.spec.ts`.

- [ ] **Step 1: Failing integration test:**
```typescript
// seeds an org + a member. generateEnrollmentCode → enroll → verify → revoke invalidates.
it('generate code → enroll → verify; revoke invalidates the token', async () => {
  const code = await svc.generateEnrollmentCode(orgId, memberId);
  const { agentId, token } = await svc.enroll(code, { name: 'edge', platform: 'linux', version: '0.0.0' });
  expect(await svc.verifyToken(token)).toEqual({ orgId, agentId });
  await expect(svc.enroll(code, { name: 'x', platform: 'linux', version: '0' })).rejects.toThrow(); // single-use
  await repo.setStatus(agentId, 'REVOKED');
  expect(await svc.verifyToken(token)).toBeNull();
});
```

- [ ] **Step 2: Run → FAIL**, then implement `agent-token.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { AgentRepository } from './agent.repository';
import { NodeScopeException } from '../common/errors/nodescope.exception';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const CODE_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class AgentTokenService {
  constructor(private readonly repo: AgentRepository) {}

  async generateEnrollmentCode(organizationId: string, memberId: string | null): Promise<string> {
    const code = randomBytes(18).toString('base64url');
    await this.repo.createCode({ organizationId, codeHash: hash(code), expiresAt: new Date(Date.now() + CODE_TTL_MS), createdByMemberId: memberId });
    return code;
  }

  async enroll(code: string, info: { name: string; platform: string; version: string }): Promise<{ agentId: string; token: string }> {
    const row = await this.repo.findValidCode(hash(code));
    if (!row) throw new NodeScopeException('AGENT_001', 'Invalid or expired enrollment code', 401);
    const token = randomBytes(32).toString('base64url');
    const agent = await this.repo.create({ organizationId: row.organizationId, name: info.name, platform: info.platform, version: info.version, tokenHash: hash(token), createdByMemberId: row.createdByMemberId });
    await this.repo.markCodeUsed(row.id);
    return { agentId: agent.id, token };
  }

  async verifyToken(token: string): Promise<{ orgId: string; agentId: string } | null> {
    if (!token) return null;
    const a = await this.repo.findByTokenHash(hash(token));
    if (!a || a.status === 'REVOKED') return null;
    return { orgId: a.organizationId, agentId: a.id };
  }
}
```
Register `AGENT_001 INVALID_ENROLLMENT_CODE` (401) in the error registry.

- [ ] **Step 3: Run → PASS.** Commit `feat(api): AgentTokenService (enroll/verify/code)`.

---

## Task 4: `AgentTokenGuard` (Jest unit)

**Files:** Create `agents/agent-token.guard.ts`; test `agents/__tests__/agent-token.guard.spec.ts`.

- [ ] **Step 1: Failing test:**
```typescript
import { UnauthorizedException } from '@nestjs/common';
import { AgentTokenGuard } from '../agent-token.guard';

const ctx = (headers: Record<string, string>) => ({ switchToHttp: () => ({ getRequest: () => ({ headers, agent: undefined as any }) }) }) as any;

describe('AgentTokenGuard', () => {
  it('attaches {orgId, agentId} and bumps last-seen', async () => {
    const tokens = { verifyToken: async () => ({ orgId: 'o', agentId: 'a' }) };
    const repo = { touchLastSeen: jest.fn() };
    const guard = new AgentTokenGuard(tokens as any, repo as any);
    const c = ctx({ 'x-agent-token': 'good' });
    expect(await guard.canActivate(c)).toBe(true);
    expect(c.switchToHttp().getRequest().agent).toEqual({ orgId: 'o', agentId: 'a' });
    expect(repo.touchLastSeen).toHaveBeenCalledWith('a');
  });
  it('rejects an invalid/revoked token', async () => {
    const guard = new AgentTokenGuard({ verifyToken: async () => null } as any, { touchLastSeen: jest.fn() } as any);
    await expect(guard.canActivate(ctx({ 'x-agent-token': 'bad' }))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `agent-token.guard.ts`:
```typescript
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AgentTokenService } from './agent-token.service';
import { AgentRepository } from './agent.repository';

@Injectable()
export class AgentTokenGuard implements CanActivate {
  constructor(private readonly tokens: AgentTokenService, private readonly repo: AgentRepository) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const resolved = await this.tokens.verifyToken((req.headers['x-agent-token'] as string) ?? '');
    if (!resolved) throw new UnauthorizedException('Invalid agent token');
    req.agent = resolved;
    await this.repo.touchLastSeen(resolved.agentId);
    return true;
  }
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(api): AgentTokenGuard`.

---

## Task 5: Widen ingest auth to the agent token (Jest e2e)

**Files:** Modify `monitoring/ingest/ingest-token.guard.ts`, `monitoring/ingest/ingest.controller.ts`.

- [ ] **Step 1: Failing e2e** — an ingest with an agent token writes status with `source = agent:<id>`:
```typescript
it('accepts an agent token and tags the source', async () => {
  const code = await agentTokens.generateEnrollmentCode(orgId, memberId);
  const { agentId, token } = await agentTokens.enroll(code, { name: 'e', platform: 'linux', version: '0' });
  await request(app.getHttpServer()).post('/v1/monitoring/ingest').set('x-agent-token', token).send({ checks: [{ deviceId, ok: true, latencyMs: 4 }] }).expect(202);
  const row = await prisma.deviceStatus.findFirst({ where: { deviceId } });
  expect(row?.source).toBe(`agent:${agentId}`);
});
```

- [ ] **Step 2: Run → FAIL**, then widen the guard. In `ingest-token.guard.ts`, try the agent token first:
```typescript
// constructor also injects AgentTokenService.
async canActivate(context: ExecutionContext): Promise<boolean> {
  const req = context.switchToHttp().getRequest();
  const agent = await this.agentTokens.verifyToken((req.headers['x-agent-token'] as string) ?? '');
  if (agent) { req.ingestOrgId = agent.orgId; req.ingestSource = `agent:${agent.agentId}`; await this.agentRepo.touchLastSeen(agent.agentId); return true; }
  const header = (req.headers['x-ingest-token'] as string) ?? (req.headers['authorization'] as string | undefined)?.replace(/^Bearer\s+/i, '');
  const orgId = await this.orgTokens.verify(header ?? '');     // Spec 7 IngestTokenService
  if (!orgId) throw new UnauthorizedException('Invalid ingest token');
  req.ingestOrgId = orgId; return true;
}
```
In `ingest.controller.ts`, use the resolved source: each `reportStatusCheck`/`reportMetric` uses `source: req.ingestSource ?? c.source ?? 'external'`. (`AgentModule` exports `AgentTokenService`/`AgentRepository`; `MonitoringModule` imports it.)

- [ ] **Step 3: Run → PASS.** Commit `feat(api): monitoring ingest accepts per-agent tokens (source=agent:<id>)`.

---

## Task 6: Phase gate

- [ ] **Step 1: Suites.** `cd apps/api && npm run test:unit -- agent-token.guard && npm run test:integration -- agent && npm run test:e2e -- ingest` → green.
- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` → PASS.
- [ ] **Step 3: Docs (Rule 10).** Register `AGENT_001` + the `Agent`/`AgentEnrollmentCode` entities in the API Design Document; SAD: the agent registry + per-agent token auth.
- [ ] **Step 4: Commit** `docs: record Spec 8 agent registry + token auth (Phase C)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** `Agent` + `AgentEnrollmentCode` models (§6) ✓ Task 1; enroll = code→token, single-use (§6) ✓ Task 3; per-agent token verify + revoke (§6, §12) ✓ Task 3; `AgentTokenGuard` + last-seen (§9) ✓ Task 4; ingest accepts the agent token, `source=agent:<id>` (§9) ✓ Task 5.
- **Deferred (correctly NOT here):** agent-facing controllers (enroll/devices/heartbeat) + management endpoints + UI + installers + e2e enroll→sync→status (Phase D).
- **Placeholder scan:** none — concrete code/commands.
- **Type consistency:** `AgentRepository` (`create`/`findByTokenHash`/`listByOrg`/`touchLastSeen`/`setStatus`/`createCode`/`findValidCode`/`markCodeUsed`) ↔ `AgentTokenService` + Phase D controllers; `AgentTokenService.enroll`→`AgentEnrollResponse` (Phase A); `verifyToken → {orgId, agentId}` ↔ both guards; `AgentStatus` from `@prisma/client`; the widened ingest guard sets `req.ingestSource` consumed by the controller.
- **Test-config compliance:** repo + token-service integration (test DB); guard unit (mocked); ingest e2e (real app, `x-agent-token` header). Reuses F1a/F3 seed/auth helpers.
- **Integration points to verify during execution:** the exact current `ChangeLog` CHECK to extend; `NodeScopeException` 401 mapping for `AGENT_001`; that `MonitoringModule` can import `AgentModule` without a circular dep (move `AgentTokenService`/`AgentRepository` to a shared providers set if needed); `req.ingestSource` threading in the existing Spec 7 controller.
