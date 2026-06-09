# F1a Phase B — Re-scope Existing Entities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every existing per-user entity (`Device`, `Network`, `DeviceConnection`, `FiberRun`, `Circuit`, `DeviceMetric`) from `userId`-owned to `organizationId`-owned, keeping `userId` as a nullable creator, and enforce the org-configurable device-naming policy.

**Architecture:** One schema migration adds `organizationId` (FK, `onDelete: Cascade`) to each entity, makes `userId` nullable (`onDelete: SetNull`), and re-points unique constraints/indexes from `userId` to `organizationId`. `OrgContextGuard` is registered globally so `request.orgMember` is always available; controllers switch from `@CurrentUser().id`-scoping to `@OrgId()`-scoping while still recording the creator. The build goes red the moment the schema changes and returns to green as each module is updated — so the entity tasks run back-to-back in one sitting.

**Tech Stack:** NestJS, Prisma 5, PostgreSQL 16 (PostGIS + TimescaleDB), Jest (test DB on `:5433`). Repository pattern, TDD, `NodeScopeException`, optimistic concurrency via `updateMany` + version.

**Depends on:** Phase A (provides `Organization` model, `OrganizationsRepository`, `OrgContextGuard`, `@OrgId()`, `@OrgRoles()`).

**Greenfield note:** No production data — the migration adds NOT NULL `organizationId` columns to tables that are reset, so no backfill is needed. The DB is recreated from migrations + seed.

---

## The Re-scope Recipe (applied identically to every entity)

Each entity task applies this exact transform. It is restated here so each task is self-contained; the per-entity tasks list only what differs.

**Schema (per model):**
- Add `organizationId String` + relation `organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)`.
- Change `userId String` → `userId String?` and its relation to `onDelete: SetNull` (where a Prisma relation exists).
- Replace every `@@index([userId, ...])` with `@@index([organizationId, ...])`.
- Replace every `@@unique([userId, ...])` with `@@unique([organizationId, ...])` (Device name uniqueness is handled by a raw-SQL case-insensitive index instead — see Task 1).

**Repository (per file):** rename the scoping parameter `userId` → `organizationId` in every method and in every `where` clause. `create` accepts both `organizationId` (scope) and `userId` (creator). Method renames: `findByIdAndUserId`→`findByIdAndOrgId`, `findAllByUserId`→`findAllByOrgId`, `deleteByIdAndUserId`→`deleteByIdAndOrgId`, `countByUserId`→`countByOrgId`, `existsByNameCaseInsensitive(userId,...)`→`existsByNameCaseInsensitive(organizationId,...)`. `updateWithVersion` scopes by `organizationId`.

**Service (per file):** methods take `organizationId` (for scoping) and `creatorUserId` (for the creator field) instead of `userId`. All repository calls pass `organizationId`.

**Controller (per file):** add `@OrgId() orgId: string` and pass it for scoping; keep `@CurrentUser() user` to pass `user.id` as the creator on create. Apply no per-controller guard (Task 2 registers `OrgContextGuard` globally).

**Tests (per file):** update fixtures to create an `Organization` and pass `organizationId`; assert cross-org isolation (an entity created under org A is invisible to a query scoped to org B).

---

## Task 1: Schema re-scope + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create (generated): `apps/api/prisma/migrations/<timestamp>_f1a_rescope_entities/migration.sql`

- [ ] **Step 1: Apply the schema recipe to all six entities**

In `schema.prisma`, for each of `Device`, `Network`, `DeviceConnection`, `FiberRun`, `Circuit`:
- add `organizationId String` and the `organization` relation (`onDelete: Cascade`);
- change `userId String` → `userId String?` and its `user` relation to `onDelete: SetNull`;
- rewrite indexes/uniques from `userId` to `organizationId`.

Worked example — `Device`:

```prisma
model Device {
  id              String         @id @default(uuid())
  organizationId  String
  userId          String?
  networkId       String?
  name            String
  category        DeviceCategory
  // ... all other existing fields unchanged ...
  version         Int            @default(1)
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User?        @relation(fields: [userId], references: [id], onDelete: SetNull)
  network      Network?     @relation(fields: [networkId], references: [id], onDelete: SetNull)
  // ... existing relation fields (connectionsFrom, fiberRunsFrom, circuits, etc.) unchanged ...

  @@unique([organizationId, browserDeviceId])
  @@index([organizationId])
  @@index([organizationId, category])
  @@index([organizationId, floor])
  @@index([organizationId, networkId])
}
```

Note: the old `@@unique([userId, name])` is intentionally NOT replaced with a Prisma `@@unique` — case-insensitive org uniqueness is enforced by a raw-SQL index in Step 3.

For `DeviceMetric` (TimescaleDB hypertable — no relations): add `organizationId String` as a plain column, replace `@@index([userId, time(sort: Desc)])` and the other `userId`-prefixed indexes with `organizationId`-prefixed equivalents; keep `userId String` as-is (metrics already treat it as a plain column). Keep the composite `@@id([id, time])`.

Also update each model's `User` back-relations: in `model User`, the relation fields (`devices`, `networks`, `circuits`, `fiberRuns`, `connections`) remain (they are now optional-FK back-relations, still valid).

- [ ] **Step 2: Create the migration**

Run: `cd apps/api && npx prisma migrate dev --name f1a_rescope_entities`
Expected: migration created and applied to the dev DB; client regenerated. (TypeScript across the repo will now fail to compile — expected; fixed in Tasks 3–8.)

- [ ] **Step 3: Add the case-insensitive unique index for device names (raw SQL)**

Edit the generated `migration.sql`, appending (mirrors the PostGIS raw-SQL precedent in the init migration):

```sql
CREATE UNIQUE INDEX "device_org_name_lower_uniq"
  ON "Device" ("organizationId", lower("name"));
```

Re-apply: `cd apps/api && npx prisma migrate reset --force` (greenfield — recreates DB from all migrations + seed).
Expected: all migrations apply, including the new index.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): re-scope entities to organizationId (userId becomes nullable creator)"
```

---

## Task 2: Register `OrgContextGuard` globally

**Files:**
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/organizations/__tests__/org-context.guard.spec.ts` (already covers the guard from Phase A)

- [ ] **Step 1: Register the guard as a global `APP_GUARD` after `AuthGuard`**

In `app.module.ts` providers, add `OrgContextGuard` as an `APP_GUARD` registered **after** the existing `AuthGuard` registration (so `request.user` is set before `OrgContextGuard` runs):

```typescript
import { APP_GUARD } from '@nestjs/core';
import { OrgContextGuard } from './organizations/guards/org-context.guard';
// ...
providers: [
  // ...existing APP_GUARD for AuthGuard (keep it first)...
  { provide: APP_GUARD, useClass: OrgContextGuard },
],
```

Ensure `OrganizationsModule` is imported in `AppModule` (it is, from Phase A) so `OrganizationsRepository` is injectable into the guard.

- [ ] **Step 2: Verify the existing guard test still passes**

Run: `cd apps/api && npm run test:unit -- org-context.guard`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/app.module.ts
git commit -m "feat(api): register OrgContextGuard globally so request.orgMember is always populated"
```

---

## Task 3: Re-scope `Device` (the exemplar — full code)

**Files:**
- Modify: `apps/api/src/devices/devices.repository.ts`
- Modify: `apps/api/src/devices/devices.service.ts`
- Modify: `apps/api/src/devices/devices.controller.ts`
- Modify: `apps/api/src/devices/__tests__/*.spec.ts`

- [ ] **Step 1: Update the repository test (org scoping + isolation)**

Replace `userId` fixtures/assertions with `organizationId`, and add an isolation case:

```typescript
it('does not return a device from another org', async () => {
  const orgA = await prisma.organization.create({ data: { name: `A${Date.now()}` } });
  const orgB = await prisma.organization.create({ data: { name: `B${Date.now()}` } });
  const d = await repo.create({ organizationId: orgA.id, userId: null, name: 'X', category: 'ROUTER' });
  expect(await repo.findByIdAndOrgId(d.id, orgB.id)).toBeNull();
  expect(await repo.findByIdAndOrgId(d.id, orgA.id)).not.toBeNull();
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npm run test:integration -- devices.repository`
Expected: FAIL — `findByIdAndOrgId` does not exist.

- [ ] **Step 3: Update the repository**

```typescript
@Injectable()
export class DevicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByIdAndOrgId(deviceId: string, organizationId: string): Promise<Device | null> {
    return this.prisma.device.findFirst({ where: { id: deviceId, organizationId } });
  }

  findAllByOrgId(organizationId: string): Promise<Device[]> {
    return this.prisma.device.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
  }

  countByOrgId(organizationId: string): Promise<number> {
    return this.prisma.device.count({ where: { organizationId } });
  }

  create(data: { organizationId: string; userId: string | null } & Record<string, unknown>): Promise<Device> {
    return this.prisma.device.create({ data: data as any });
  }

  async updateWithVersion(
    deviceId: string,
    organizationId: string,
    data: Prisma.DeviceUpdateInput,
    expectedVersion: number,
  ): Promise<Device | null> {
    const result = await this.prisma.device.updateMany({
      where: { id: deviceId, organizationId, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return this.prisma.device.findUnique({ where: { id: deviceId } });
  }

  async deleteByIdAndOrgId(deviceId: string, organizationId: string): Promise<void> {
    await this.prisma.device.deleteMany({ where: { id: deviceId, organizationId } });
  }

  async existsByNameCaseInsensitive(
    organizationId: string,
    name: string,
    excludeDeviceId?: string,
  ): Promise<boolean> {
    const device = await this.prisma.device.findFirst({
      where: {
        organizationId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeDeviceId && { NOT: { id: excludeDeviceId } }),
      },
      select: { id: true },
    });
    return device !== null;
  }
}
```

- [ ] **Step 4: Run the repository test to verify it passes**

Run: `cd apps/api && npm run test:integration -- devices.repository`
Expected: PASS.

- [ ] **Step 5: Update the service (scope by org, record creator)**

Change every method to take `organizationId` for scoping and `creatorUserId` for the creator field. Example signatures:

```typescript
async listDevices(organizationId: string): Promise<DeviceDto[]> {
  const devices = await this.devicesRepository.findAllByOrgId(organizationId);
  return devices.map((d) => this.toDto(d));
}

async createDevice(organizationId: string, creatorUserId: string, dto: CreateDeviceDto): Promise<DeviceDto> {
  // (device-limit tier check from the original code is removed/neutralized — tiers are out of scope;
  //  if the tier check remains elsewhere, leave it but do not block on it.)
  const device = await this.devicesRepository.create({ organizationId, userId: creatorUserId, ...dto });
  return this.toDto(device);
}

async updateDevice(organizationId: string, deviceId: string, patch: PatchDeviceDto): Promise<DeviceDto> {
  const device = await this.devicesRepository.findByIdAndOrgId(deviceId, organizationId);
  if (!device) throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
  const updatePayload = this.conflictService.buildUpdatePayload(patch, DEVICE_WRITABLE_FIELDS, device.version, CreateDeviceDto);
  const updated = await this.devicesRepository.updateWithVersion(deviceId, organizationId, updatePayload, patch.baseVersion);
  if (!updated) throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);
  this.conflictService.emitEntityEvent(WS_EVENTS.DEVICE_UPDATED, { deviceId, changes: patch.changes }, /* creator */ device.userId ?? '');
  return this.toDto(updated);
}

async deleteDevice(organizationId: string, deviceId: string): Promise<void> {
  const device = await this.devicesRepository.findByIdAndOrgId(deviceId, organizationId);
  if (!device) throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
  await this.devicesRepository.deleteByIdAndOrgId(deviceId, organizationId);
  this.conflictService.emitEntityEvent(WS_EVENTS.DEVICE_DELETED, { deviceId }, device.userId ?? '');
}
```

Note: WS emission still targets the user in Phase B (the `emitEntityEvent` third arg). Phase D switches emission to the org room — do not change it here.

- [ ] **Step 6: Update the controller**

```typescript
import { OrgId } from '../organizations/decorators/org-id.decorator';

@Get()
async listDevices(@OrgId() orgId: string) {
  return { success: true, data: await this.devicesService.listDevices(orgId), timestamp: new Date().toISOString() };
}

@Post()
@UseInterceptors(IdempotencyInterceptor)
async createDevice(@OrgId() orgId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDeviceDto) {
  const data = await this.devicesService.createDevice(orgId, user.id, dto);
  return { success: true, data, timestamp: new Date().toISOString() };
}

@Patch(':id')
async updateDevice(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() patch: PatchDeviceDto) {
  return { success: true, data: await this.devicesService.updateDevice(orgId, id, patch), timestamp: new Date().toISOString() };
}

@Delete(':id')
async deleteDevice(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
  await this.devicesService.deleteDevice(orgId, id);
  return { success: true, data: null, timestamp: new Date().toISOString() };
}
```

- [ ] **Step 7: Update the service/e2e tests, then run the device suite**

Update device service unit tests and any device e2e to pass `organizationId` (and seed an org + membership in e2e, injecting the user via the same override pattern from Phase A Task 10).

Run: `cd apps/api && npm run test:unit -- devices && npm run test:integration -- devices && npm run test:e2e -- devices`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/devices
git commit -m "feat(api): re-scope Device module to organizationId"
```

---

## Tasks 4–7: Re-scope `Network`, `DeviceConnection`, `FiberRun`, `Circuit`

Each follows the **Re-scope Recipe** and the Device exemplar (Task 3) exactly. Per-entity specifics below — apply Steps mirroring Task 3 (update test → fail → update repo → pass → update service+controller → run suite → commit) for each.

- [ ] **Task 4 — `Network`** (`apps/api/src/networks/*`)
  - Repo methods to rename: `findByIdAndOrgId`, `findAllByOrgId`, `updateWithVersion(id, organizationId, ...)`, `deleteByIdAndOrgId`. `create({ organizationId, userId, ...dto })`.
  - `homeLatitude`/`homeLongitude`/`homeAddress`/`propertyId` fields are unchanged (`propertyId` stays reserved/null — F2).
  - Controller: `@OrgId() orgId` for scoping, `@CurrentUser() user` for creator.
  - Commit: `feat(api): re-scope Network module to organizationId`.

- [ ] **Task 5 — `DeviceConnection`** (`apps/api/src/connections/*`)
  - Repo scoping by `organizationId`; `sourceDeviceId`/`targetDeviceId` unchanged.
  - Replace `@@unique([userId, sourceDeviceId, targetDeviceId, connectionType])` → `@@unique([organizationId, sourceDeviceId, targetDeviceId, connectionType])` (already done in Task 1; verify).
  - Commit: `feat(api): re-scope DeviceConnection module to organizationId`.

- [ ] **Task 6 — `FiberRun`** (`apps/api/src/fiber-runs/*`)
  - Repo scoping by `organizationId`; `startDeviceId`/`endDeviceId`/`cableType`/`lengthMeters` unchanged.
  - Commit: `feat(api): re-scope FiberRun module to organizationId`.

- [ ] **Task 7 — `Circuit`** (`apps/api/src/circuits/*`)
  - Repo scoping by `organizationId`; cursor-based pagination `where` clause switches `userId` → `organizationId`; `deviceId` link unchanged.
  - Commit: `feat(api): re-scope Circuit module to organizationId`.

For each: run `npm run test:unit/-integration/-e2e -- <module>` and confirm green before committing. Add a cross-org isolation assertion to each repository test (as in Task 3 Step 1).

---

## Task 8: Re-scope `DeviceMetric` (hypertable)

**Files:**
- Modify: `apps/api/src/metrics/*` (repository + service + tests)

- [ ] **Step 1: Update the metrics repository test** to create metrics with `organizationId` and assert queries scope by `organizationId` (not `userId`).

- [ ] **Step 2: Run to verify it fails.** `cd apps/api && npm run test:integration -- metrics` → FAIL.

- [ ] **Step 3: Update the repository** — every `where` and insert switches `userId` → `organizationId` for scoping. `organizationId` is a plain column (no relation); set it on insert from the request's org. Keep `userId` as a plain column too (the originating user).

- [ ] **Step 4: Run to verify it passes.** Expected: PASS.

- [ ] **Step 5: Update the metrics ingestion path** (controller and/or WebSocket handler) to stamp `organizationId` from `request.orgMember.organizationId` / `socket.data` org context.

- [ ] **Step 6: Commit** `feat(api): re-scope DeviceMetric to organizationId`.

---

## Task 9: Enforce the org naming policy on devices

**Files:**
- Create: `apps/api/src/organizations/naming-policy.ts`
- Modify: `apps/api/src/devices/devices.service.ts`
- Test: `apps/api/src/devices/__tests__/devices.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('rejects a device name that is already taken in the org (ORG_005)', async () => {
  devicesRepository.existsByNameCaseInsensitive.mockResolvedValue(true);
  orgsRepository.findOrganizationById.mockResolvedValue({ id: 'o1', namingPattern: null, namingMaxLen: 63 });
  await expect(service.createDevice('o1', 'u1', { name: 'Dup', category: 'ROUTER' } as any))
    .rejects.toMatchObject({ code: 'ORG_005' });
});

it('rejects a name violating the org naming pattern (ORG_006)', async () => {
  devicesRepository.existsByNameCaseInsensitive.mockResolvedValue(false);
  orgsRepository.findOrganizationById.mockResolvedValue({ id: 'o1', namingPattern: '^[a-z]+-[0-9]{2}$', namingMaxLen: 63 });
  await expect(service.createDevice('o1', 'u1', { name: 'BadName', category: 'ROUTER' } as any))
    .rejects.toMatchObject({ code: 'ORG_006' });
});
```

- [ ] **Step 2: Run to verify it fails.** `cd apps/api && npm run test:unit -- devices.service` → FAIL.

- [ ] **Step 3: Implement the naming-policy helper**

`naming-policy.ts`:

```typescript
import { HttpStatus } from '@nestjs/common';
import { NodeScopeException } from '../common/filters/global-exception.filter';

export function assertNameMatchesPolicy(
  name: string,
  policy: { namingPattern: string | null; namingMaxLen: number | null },
): void {
  const maxLen = policy.namingMaxLen ?? 63;
  if (name.length > maxLen) {
    throw new NodeScopeException('ORG_006', 'NAMING_POLICY_VIOLATION', HttpStatus.UNPROCESSABLE_ENTITY);
  }
  if (policy.namingPattern) {
    let re: RegExp;
    try { re = new RegExp(policy.namingPattern); }
    catch { return; } // a malformed stored pattern never blocks writes
    if (!re.test(name)) {
      throw new NodeScopeException('ORG_006', 'NAMING_POLICY_VIOLATION', HttpStatus.UNPROCESSABLE_ENTITY);
    }
  }
}
```

- [ ] **Step 4: Call it in `createDevice` and on rename**

In `DevicesService.createDevice`, before `repository.create`, inject `OrganizationsRepository`, then:

```typescript
const org = await this.organizationsRepository.findOrganizationById(organizationId);
if (!org) throw new NodeScopeException('ORG_001', 'ORGANIZATION_NOT_FOUND', HttpStatus.NOT_FOUND);
if (await this.devicesRepository.existsByNameCaseInsensitive(organizationId, dto.name)) {
  throw new NodeScopeException('ORG_005', 'DEVICE_NAME_TAKEN', HttpStatus.CONFLICT);
}
assertNameMatchesPolicy(dto.name, org);
```

When an update changes `name`, apply the same uniqueness check (with `excludeDeviceId`) and `assertNameMatchesPolicy` before `updateWithVersion`. Add `OrganizationsModule` to `DevicesModule` imports if not already present (it exports `OrganizationsRepository`).

- [ ] **Step 5: Run to verify it passes.** `cd apps/api && npm run test:unit -- devices.service` → PASS.

- [ ] **Step 6: Commit** `feat(api): enforce org-wide unique names + naming policy on devices`.

---

## Task 10: Rewrite the seed for org scoping

**Files:**
- Modify: `apps/api/prisma/seed.ts`

- [ ] **Step 1: Seed an org, a super-admin, an owner, and org-scoped data**

```typescript
const org = await prisma.organization.create({ data: { name: 'Acme Networks' } });
await prisma.organizationDomain.create({ data: { organizationId: org.id, domain: 'acme.test', verified: true } });

const superAdmin = await prisma.user.upsert({
  where: { email: 'admin@nodescope.test' },
  update: { isSuperAdmin: true },
  create: { email: 'admin@nodescope.test', emailVerified: true, name: 'Platform Admin', isSuperAdmin: true },
});

const owner = await prisma.user.upsert({
  where: { email: 'owner@acme.test' },
  update: {},
  create: { email: 'owner@acme.test', emailVerified: true, name: 'Acme Owner' },
});
await prisma.organizationMember.upsert({
  where: { userId: owner.id },
  update: {},
  create: { userId: owner.id, organizationId: org.id, role: 'OWNER' },
});

// seedDevices/seedConnections/etc. now take organizationId (+ owner.id as creator)
await seedDevices(org.id, owner.id);
```

Update each `seedX(...)` helper to accept `(organizationId, creatorUserId)` and stamp both on every `create`. Replace all `userId`-only `where`/`data` with `organizationId`.

- [ ] **Step 2: Run the seed against a fresh DB**

Run: `cd apps/api && npx prisma migrate reset --force`
Expected: migrations apply, seed runs cleanly, sample org + data created.

- [ ] **Step 3: Commit** `chore(api): rewrite seed for organization scoping`.

---

## Task 11: Full suite green + docs

- [ ] **Step 1: Run the entire backend suite**

Run: `cd apps/api && npm run test:unit && npm run test:integration && npm run test:e2e`
Expected: all green. If any module still references `userId`-scoping, fix it (compile errors will point to it).

- [ ] **Step 2: Update docs (Rule 10)** — note the org-scoping change in the SAD multi-tenancy section / CLAUDE.md module notes; confirm `ORG_005`/`ORG_006` are registered in the API Design Document.

- [ ] **Step 3: Commit** `docs: record org-scoping of all entities; test: full suite green`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** re-scope all entities (§4.3) ✓ Tasks 1, 3–8; FK onDelete changes (§4.4) ✓ Task 1; case-insensitive unique index (§4.5) ✓ Task 1 Step 3; naming policy (§6) ✓ Task 9; session-derived org enforcement (§8) ✓ Task 2 + `@OrgId()` usage; greenfield migration (§9) ✓ Tasks 1, 10. Deferred (correct): audit writers (§5) → Phase C; org realtime rooms (§8 realtime) → Phase D.
- **Type consistency:** repo method names (`findByIdAndOrgId`, `findAllByOrgId`, `countByOrgId`, `deleteByIdAndOrgId`, `existsByNameCaseInsensitive(organizationId,...)`) are used identically across Tasks 3–8. Service signatures take `(organizationId, creatorUserId, ...)` uniformly. `assertNameMatchesPolicy(name, {namingPattern, namingMaxLen})` matches `OrganizationDto`/`Organization` fields.
- **Build-green sequencing:** Task 1 reddens the build; Tasks 2–10 restore it module by module; Task 11 verifies the whole suite. Intended to run in one sitting.
- **Integration points to verify during execution:** exact `AuthGuard` global-registration style in `app.module.ts` (Task 2), the metrics ingestion entry point (Task 8 Step 5), and whether `DevicesModule` already imports `OrganizationsModule` (Task 9 Step 4).
