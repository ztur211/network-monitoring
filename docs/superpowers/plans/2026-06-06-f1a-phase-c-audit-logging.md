# F1a Phase C — Audit Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write a complete, append-only audit trail to `ChangeLog` on every entity create/update/delete — capturing the action, the org, a per-request correlation id, and the actor (id + IP + user-agent) taken from the authenticated session, never from the request body.

**Architecture:** A request-scoped `AuditStore` ({ requestId, userId, ipAddress, userAgent }) lives in a Node `AsyncLocalStorage`. A global middleware opens the store (with `requestId`/IP/UA, available pre-auth) and runs the rest of the request inside it; the existing `AuthGuard` fills in `userId` after it resolves the session (it runs inside the middleware's async context, so it mutates the same store). An `AuditService` reads the store and writes `ChangeLog` rows via a `ChangeLogRepository`. Entity services call the audit service after each successful create/update/delete.

**Tech Stack:** NestJS, Node `AsyncLocalStorage` (built-in — no new dependency), Prisma, Jest. `NodeScopeException` unchanged.

**Depends on:** Phase A (ChangeLog audit columns: `action`, `organizationId`, `requestId`, `snapshot`, `ipAddress`, `userAgent`) and Phase B (entities org-scoped). Metrics are intentionally excluded (`DeviceMetric` is immutable/append-only — no audit rows).

---

## File Structure

**Create:**
- `apps/api/src/audit/audit.als.ts` — the `AsyncLocalStorage` instance + `AuditStore` type
- `apps/api/src/audit/audit-context.middleware.ts` — opens the store per request
- `apps/api/src/audit/change-log.repository.ts` — Prisma writes for `ChangeLog`
- `apps/api/src/audit/audit.service.ts` — `recordCreate/recordUpdate/recordDelete`
- `apps/api/src/audit/audit.module.ts`
- `apps/api/src/audit/__tests__/audit.service.spec.ts`
- `apps/api/src/audit/__tests__/audit.integration-spec.ts`

**Modify:**
- `apps/api/src/auth/guards/auth.guard.ts` — set `userId` into the audit store after resolving the session
- `apps/api/src/app.module.ts` — apply `AuditContextMiddleware` globally; import `AuditModule`
- each entity service (`devices`, `networks`, `connections`, `fiber-runs`, `circuits`) — call the audit service after CRUD

---

## Task 1: Request-scoped audit context (ALS + middleware + guard hook)

**Files:**
- Create: `apps/api/src/audit/audit.als.ts`
- Create: `apps/api/src/audit/audit-context.middleware.ts`
- Modify: `apps/api/src/auth/guards/auth.guard.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Define the store and ALS instance**

`audit.als.ts`:

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuditStore {
  requestId: string;
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export const auditAls = new AsyncLocalStorage<AuditStore>();
```

- [ ] **Step 2: Write the middleware**

`audit-context.middleware.ts`:

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { auditAls } from './audit.als';

@Injectable()
export class AuditContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const store = {
      requestId: randomUUID(),
      userId: null,
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    };
    auditAls.run(store, () => next());
  }
}
```

- [ ] **Step 3: Fill in `userId` from the AuthGuard**

In `auth.guard.ts`, immediately after `request.user = session.user;`, add:

```typescript
const auditStore = auditAls.getStore();
if (auditStore) auditStore.userId = (session.user as { id: string }).id;
```

(The guard runs inside the middleware's `als.run` continuation, so this mutates the same per-request store.)

- [ ] **Step 4: Apply the middleware globally**

In `app.module.ts`, implement `NestModule.configure`:

```typescript
import { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { AuditContextMiddleware } from './audit/audit-context.middleware';

export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuditContextMiddleware).forRoutes('*');
  }
}
```

- [ ] **Step 5: Verify compile**

Run: `cd apps/api && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/audit/audit.als.ts apps/api/src/audit/audit-context.middleware.ts apps/api/src/auth/guards/auth.guard.ts apps/api/src/app.module.ts
git commit -m "feat(api): request-scoped audit context (requestId + actor) via AsyncLocalStorage"
```

---

## Task 2: `ChangeLogRepository` + `AuditService`

**Files:**
- Create: `apps/api/src/audit/change-log.repository.ts`
- Create: `apps/api/src/audit/audit.service.ts`
- Create: `apps/api/src/audit/audit.module.ts`
- Test: `apps/api/src/audit/__tests__/audit.service.spec.ts`

- [ ] **Step 1: Write the failing service test**

```typescript
import { Test } from '@nestjs/testing';
import { AuditService } from '../audit.service';
import { ChangeLogRepository } from '../change-log.repository';
import { auditAls } from '../audit.als';

describe('AuditService', () => {
  let service: AuditService;
  let repo: { createMany: jest.Mock };

  beforeEach(async () => {
    repo = { createMany: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [AuditService, { provide: ChangeLogRepository, useValue: repo }],
    }).compile();
    service = moduleRef.get(AuditService);
  });

  it('writes one CREATE row with a snapshot and the actor from context', async () => {
    await auditAls.run(
      { requestId: 'req-1', userId: 'u1', ipAddress: '1.2.3.4', userAgent: 'jest' },
      async () => service.recordCreate('org1', 'Device', { id: 'd1', name: 'X' }),
    );
    expect(repo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        organizationId: 'org1', userId: 'u1', requestId: 'req-1',
        action: 'CREATE', entityType: 'Device', entityId: 'd1',
        field: null, snapshot: { id: 'd1', name: 'X' }, ipAddress: '1.2.3.4', userAgent: 'jest',
      }),
    ]);
  });

  it('writes one UPDATE row per changed field sharing the requestId', async () => {
    await auditAls.run(
      { requestId: 'req-2', userId: 'u1', ipAddress: null, userAgent: null },
      async () => service.recordUpdate('org1', 'Device', 'd1', [
        { field: 'name', oldValue: 'A', newValue: 'B' },
        { field: 'floor', oldValue: 1, newValue: 2 },
      ]),
    );
    const rows = repo.createMany.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r.requestId === 'req-2' && r.action === 'UPDATE')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `cd apps/api && npm run test:unit -- audit.service` → FAIL (module not found).

- [ ] **Step 3: Implement the repository**

`change-log.repository.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChangeLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createMany(rows: Prisma.ChangeLogCreateManyInput[]): Promise<void> {
    if (rows.length === 0) return;
    await this.prisma.changeLog.createMany({ data: rows });
  }
}
```

- [ ] **Step 4: Implement the service**

`audit.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { auditAls } from './audit.als';
import { ChangeLogRepository } from './change-log.repository';

interface FieldChange { field: string; oldValue: unknown; newValue: unknown; }

@Injectable()
export class AuditService {
  constructor(private readonly repo: ChangeLogRepository) {}

  private base(organizationId: string, entityType: string, entityId: string) {
    const ctx = auditAls.getStore();
    return {
      organizationId,
      userId: ctx?.userId ?? null,
      requestId: ctx?.requestId ?? 'unknown',
      ipAddress: ctx?.ipAddress ?? null,
      userAgent: ctx?.userAgent ?? null,
      entityType,
      entityId,
    };
  }

  async recordCreate(organizationId: string, entityType: string, entity: { id: string } & Record<string, unknown>): Promise<void> {
    await this.repo.createMany([{
      ...this.base(organizationId, entityType, entity.id),
      action: 'CREATE', field: null, oldValue: null, newValue: null,
      snapshot: entity as Prisma.InputJsonValue,
    }]);
  }

  async recordUpdate(organizationId: string, entityType: string, entityId: string, changes: FieldChange[]): Promise<void> {
    const b = this.base(organizationId, entityType, entityId);
    await this.repo.createMany(changes.map((c) => ({
      ...b, action: 'UPDATE', field: c.field,
      oldValue: c.oldValue == null ? null : String(c.oldValue),
      newValue: c.newValue == null ? null : String(c.newValue),
      snapshot: undefined,
    })));
  }

  async recordDelete(organizationId: string, entityType: string, entity: { id: string } & Record<string, unknown>): Promise<void> {
    await this.repo.createMany([{
      ...this.base(organizationId, entityType, entity.id),
      action: 'DELETE', field: null, oldValue: null, newValue: null,
      snapshot: entity as Prisma.InputJsonValue,
    }]);
  }
}
```

- [ ] **Step 5: Implement the module (exported globally for entity services)**

`audit.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChangeLogRepository } from './change-log.repository';
import { AuditService } from './audit.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [ChangeLogRepository, AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```

Import `AuditModule` in `AppModule`.

- [ ] **Step 6: Run to verify it passes.** `cd apps/api && npm run test:unit -- audit.service` → PASS.

- [ ] **Step 7: Commit** `feat(api): add ChangeLogRepository and AuditService`.

---

## Task 3: Wire audit into the `Device` service (exemplar) + integration test

**Files:**
- Modify: `apps/api/src/devices/devices.service.ts`
- Test: `apps/api/src/devices/__tests__/devices.integration-spec.ts` (or the existing device integration test)

- [ ] **Step 1: Write the failing integration test**

```typescript
it('writes a CREATE ChangeLog row scoped to the org when a device is created', async () => {
  const org = await prisma.organization.create({ data: { name: `Au${Date.now()}` } });
  const user = await prisma.user.create({ data: { email: `a-${Date.now()}@x.com`, emailVerified: true, name: 'A' } });

  await auditAls.run(
    { requestId: 'r1', userId: user.id, ipAddress: null, userAgent: null },
    async () => service.createDevice(org.id, user.id, { name: 'AuditCam', category: 'IOT_DEVICE' } as any),
  );

  const logs = await prisma.changeLog.findMany({ where: { organizationId: org.id, entityType: 'Device', action: 'CREATE' } });
  expect(logs).toHaveLength(1);
  expect(logs[0].requestId).toBe('r1');
  expect(logs[0].userId).toBe(user.id);

  await prisma.changeLog.deleteMany({ where: { organizationId: org.id } });
  await prisma.device.deleteMany({ where: { organizationId: org.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});
```

- [ ] **Step 2: Run to verify it fails.** `cd apps/api && npm run test:integration -- devices` → FAIL (no ChangeLog written).

- [ ] **Step 3: Inject `AuditService` and call it after each CRUD**

In `DevicesService`, add `private readonly audit: AuditService` to the constructor, then:
- after `repository.create(...)` → `await this.audit.recordCreate(organizationId, 'Device', created);`
- in `updateDevice`, after a successful `updateWithVersion` → `await this.audit.recordUpdate(organizationId, 'Device', deviceId, patch.changes);`
- in `deleteDevice`, after the delete → `await this.audit.recordDelete(organizationId, 'Device', device);` (pass the entity fetched before deletion).

- [ ] **Step 4: Run to verify it passes.** Expected: PASS.

- [ ] **Step 5: Commit** `feat(api): audit Device create/update/delete to ChangeLog`.

---

## Task 4: Wire audit into the remaining entity services

Apply Task 3's pattern (inject `AuditService`; `recordCreate` after create, `recordUpdate` after a successful versioned update using `patch.changes`, `recordDelete` after delete using the pre-delete entity) to each service. Use the entity-type string shown.

- [ ] **`networks`** → entityType `'Network'`. Commit `feat(api): audit Network CRUD`.
- [ ] **`connections`** → entityType `'DeviceConnection'`. Commit `feat(api): audit DeviceConnection CRUD`.
- [ ] **`fiber-runs`** → entityType `'FiberRun'`. Commit `feat(api): audit FiberRun CRUD`.
- [ ] **`circuits`** → entityType `'Circuit'`. Commit `feat(api): audit Circuit CRUD`.

For each: add a unit or integration assertion that a create writes one `CREATE` row for that `entityType`, run `npm run test:* -- <module>` green, then commit.

---

## Task 5: Full suite + docs

- [ ] **Step 1: Run the full backend suite.** `cd apps/api && npm run test:unit && npm run test:integration && npm run test:e2e` → all green.
- [ ] **Step 2: Manual sanity (optional).** Start the API against the dev DB, create a device via the API, and confirm a `ChangeLog` row exists with `action=CREATE`, the right `organizationId`, a `requestId`, and `userId` from the session.
- [ ] **Step 3: Docs (Rule 10).** Note in the SAD/CLAUDE.md that all entity mutations are audited; confirm the audit behavior is described where the `ChangeLog` model is documented.
- [ ] **Step 4: Commit** `docs: document the audit trail; test: full suite green`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** full audit upgrade (§5) — action/org/requestId/actor IP+UA/snapshot ✓ Tasks 1–2; create/update/delete first-class ✓ Tasks 3–4; actor from session never body (§5, §11) ✓ Task 1 Step 3 (userId set by AuthGuard into the store); kept forever (no purge) ✓ (no deletion logic added). Metrics excluded by design (immutable).
- **Type consistency:** `AuditStore` fields match what `AuditService.base()` reads; `recordCreate/recordUpdate/recordDelete(organizationId, entityType, ...)` signatures used identically in Tasks 3–4; `FieldChange {field, oldValue, newValue}` matches the existing `ChangesetChangeDto` shape passed as `patch.changes`.
- **Correctness note verified:** middleware runs before `AuthGuard`, so `requestId`/IP/UA are captured at middleware time and `userId` is filled by the guard *within the same ALS continuation* (guard executes inside the middleware's `als.run(() => next())`). This is why `userId` is mutable-in-store rather than captured in the middleware.
- **Integration points to verify during execution:** the exact location of `request.user = session.user` in `auth.guard.ts` (Task 1 Step 3); that `AppModule` doesn't already implement `configure()` (merge if it does); the constructor DI list of each entity service (Task 4).
