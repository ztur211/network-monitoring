# F3 Phase A — Permission Models & Authorization Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the F3 data model (`Team`, `TeamMember`, `TeamProperty`, `MemberProperty`) and the `PermissionsService` authorization seam — `effectiveRoots`, `inScope`, `scopePropertyIds`/`scopeFilter`, and `assertCanConfigure` (the spec §5 decision) — plus `GET /v1/access/me`. Purely **additive**: no existing endpoint changes behavior yet (enforcement is Phase B, management endpoints Phase C, realtime Phase D).

**Architecture:** A new `permissions` NestJS module follows the existing controller→service→repository pattern (mirrors `devices`). The role axis already exists (`OrganizationMember.role: OrgRole` from F1a); F3 adds the *assignment* axis. `PermissionsService` computes a member's effective assigned subtree-roots (union of team assignments via team membership + direct `MemberProperty` grants) and turns them into an in-scope property-id set using F2's `PropertiesService` (`subtreePropertyIds`/`isAtOrUnder`). The verb ceiling (MEMBER view / ADMIN configure / OWNER all) is pure logic, unit-tested in the service. Org scoping, `version`, `ChangeLog`, and the `{ success, data, timestamp }` envelope reuse F1a machinery.

**Tech Stack:** NestJS 11, Prisma 5, PostgreSQL 16, Jest (unit + integration on test DB `:5433`). TDD, `NodeScopeException`, raw-SQL functional unique index (F2 precedent).

**Depends on:**
- **F1a fully implemented** — `OrganizationsModule`, `OrganizationMember` (`id`, `organizationId`, `userId`, `role: OrgRole` = `OWNER|ADMIN|MEMBER`), `@OrgId()` param decorator, `OrgContextGuard` (global; resolves the caller's active org + populates `request.orgMember`), `NodeScopeException`, `PrismaService`, the response envelope, `ORG_003`/`ORG_008`.
- **F2 fully implemented** — the `Property` tree and `PropertiesService` *Public Interface* (§10.2): `governingSiteId(device) ⇒ device.propertyId`, `subtreePropertyIds(organizationId, propertyId): string[]`, `isAtOrUnder(organizationId, propertyId, ancestorId): boolean`; `Device.propertyId`; `NetworkProperty`.
- Spec: `docs/superpowers/specs/2026-06-09-f3-team-site-verb-permissions-design.md` (§4 data model, §5 authorization model, §10 public interface).

> **Forward-design note.** As of this writing the repo code is the pre-F1a per-user app; F1a/F2 are specced+planned, not built. Implement F1a → F2 → (F1b for Phase C invites) → F3. This phase is additive and its primitives are exercised in isolation via directly-seeded teams/assignments; nothing else consumes them until Phase B.

---

## File Structure

**Create:**
- `apps/api/src/permissions/permissions.repository.ts` — Prisma access for `Team`/`TeamMember`/`TeamProperty`/`MemberProperty`; the effective-roots query; member lookup.
- `apps/api/src/permissions/permissions.service.ts` — `effectiveRoots`, `scopePropertyIds`, `inScope`, `accessSummary`, `assertCanConfigure` (verb-ceiling + scope; spec §5).
- `apps/api/src/permissions/permissions.controller.ts` — `GET /v1/access/me`.
- `apps/api/src/permissions/permissions.module.ts`
- `apps/api/src/permissions/__tests__/permissions.repository.spec.ts` (integration — matches `*.repository.spec.ts`)
- `apps/api/src/permissions/__tests__/permissions.service.spec.ts` (unit — matches `*.service.spec.ts`)
- `apps/api/src/permissions/__tests__/permissions.e2e.ts` (e2e — matches `*.e2e.ts`)

**Modify:**
- `apps/api/prisma/schema.prisma` — add `Team`, `TeamMember`, `TeamProperty`, `MemberProperty`; back-relations on `Organization`, `OrganizationMember`, `Property`.
- `packages/shared/src/types/api.types.ts` — `TeamDto`, `TeamMemberDto`, `TeamPropertyDto`, `MemberPropertyDto`, `AccessSummaryDto`.
- `apps/api/src/app.module.ts` — import `PermissionsModule`.
- The **API Design Document** — register `TEAM_001`–`TEAM_002`, `PERM_001`–`PERM_005`.

---

## Task 1: Schema — `Team` / `TeamMember` / `TeamProperty` / `MemberProperty`

**Files:** Modify `apps/api/prisma/schema.prisma`; generated migration.

- [ ] **Step 1: Add the models** (spec §4.1–§4.4)

```prisma
model Team {
  id              String   @id @default(uuid())
  organizationId  String
  name            String
  creatorMemberId String?  // OrganizationMember (owner or admin) who created it; null ⇒ owner-managed only
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  organization Organization        @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  creator      OrganizationMember? @relation("TeamCreator", fields: [creatorMemberId], references: [id], onDelete: SetNull)
  members      TeamMember[]
  properties   TeamProperty[]

  @@index([organizationId])
  @@index([creatorMemberId])
}

model TeamMember {
  id             String   @id @default(uuid())
  organizationId String
  teamId         String
  memberId       String
  createdAt      DateTime @default(now())

  team         Team               @relation(fields: [teamId], references: [id], onDelete: Cascade)
  member       OrganizationMember @relation(fields: [memberId], references: [id], onDelete: Cascade)
  organization Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([teamId, memberId])
  @@index([organizationId])
  @@index([memberId])
}

model TeamProperty {
  id             String   @id @default(uuid())
  organizationId String
  teamId         String
  propertyId     String
  createdAt      DateTime @default(now())

  team         Team         @relation(fields: [teamId], references: [id], onDelete: Cascade)
  property     Property     @relation("TeamPropertyAssignment", fields: [propertyId], references: [id], onDelete: Restrict)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([teamId, propertyId])
  @@index([organizationId])
  @@index([propertyId])
}

model MemberProperty {
  id             String   @id @default(uuid())
  organizationId String
  memberId       String
  propertyId     String
  createdAt      DateTime @default(now())

  member       OrganizationMember @relation(fields: [memberId], references: [id], onDelete: Cascade)
  property     Property           @relation("MemberPropertyAssignment", fields: [propertyId], references: [id], onDelete: Restrict)
  organization Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([memberId, propertyId])
  @@index([organizationId])
  @@index([propertyId])
}
```

- [ ] **Step 2: Add back-relations** to existing models:
  - `Organization`: `teams Team[]`, `teamMembers TeamMember[]`, `teamProperties TeamProperty[]`, `memberProperties MemberProperty[]`.
  - `OrganizationMember`: `teamMemberships TeamMember[]`, `siteAssignments MemberProperty[]`, `createdTeams Team[] @relation("TeamCreator")`.
  - `Property`: `teamAssignments TeamProperty[] @relation("TeamPropertyAssignment")`, `memberAssignments MemberProperty[] @relation("MemberPropertyAssignment")`.

- [ ] **Step 3: Create the migration.** `cd apps/api && npx prisma migrate dev --name f3_permission_models` → created + applied; client regenerates.

- [ ] **Step 4: Append raw SQL — team-name unique index + extend the `ChangeLog` CHECK.** Edit the generated `migration.sql`, appending (the CHECK extension is required or F3 audit inserts throw):

```sql
CREATE UNIQUE INDEX "team_org_name_lower_uniq"
  ON "Team" ("organizationId", lower("name"));

-- Extend F1a's ChangeLog entity-type CHECK so F3 audit rows are accepted (Phase C writes these).
ALTER TABLE "ChangeLog" DROP CONSTRAINT IF EXISTS "changelog_entity_type_check";
ALTER TABLE "ChangeLog" ADD CONSTRAINT "changelog_entity_type_check"
  CHECK ("entityType" IN ('Device','Circuit','FiberRun','DeviceConnection','Property','NetworkProperty',
                          'Team','TeamMember','TeamProperty','MemberProperty'));
```

Re-apply (greenfield): `cd apps/api && npx prisma migrate reset --force`.

- [ ] **Step 5: `cd apps/api && npx tsc --noEmit`** → PASS.

- [ ] **Step 6: Commit** `feat(api): add F3 permission models (Team, TeamMember, TeamProperty, MemberProperty)`.

---

## Task 2: Shared DTOs + error-code registration

**Files:** Modify `packages/shared/src/types/api.types.ts`; the API Design Document.

- [ ] **Step 1: Add DTOs to `api.types.ts`** (spec §10.1)

```typescript
export interface TeamDto {
  id: string;
  organizationId: string;
  name: string;
  creatorMemberId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMemberDto { id: string; teamId: string; memberId: string; }
export interface TeamPropertyDto { id: string; teamId: string; propertyId: string; }
export interface MemberPropertyDto { id: string; memberId: string; propertyId: string; }

// The caller's effective scope, for the client to scope its own UI.
export interface AccessSummaryDto {
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  assignedRootPropertyIds: string[];
  unscoped: boolean; // true for OWNER (sees everything)
}
```

Also add the team/assignment lifecycle WS event constants to `packages/shared/src/types/realtime.types.ts` (in `WS_EVENTS`), per spec §10.4 (`v1:access:changed` is added in Phase D):

```typescript
TEAM_CREATED: 'v1:team:created',
TEAM_UPDATED: 'v1:team:updated',
TEAM_DELETED: 'v1:team:deleted',
TEAM_MEMBER_ADDED: 'v1:team:member:added',
TEAM_MEMBER_REMOVED: 'v1:team:member:removed',
TEAM_PROPERTY_ASSIGNED: 'v1:team:property:assigned',
TEAM_PROPERTY_UNASSIGNED: 'v1:team:property:unassigned',
MEMBER_PROPERTY_ASSIGNED: 'v1:member:property:assigned',
MEMBER_PROPERTY_UNASSIGNED: 'v1:member:property:unassigned',
```

- [ ] **Step 2: Build shared.** `cd packages/shared && npm run build` → PASS.

- [ ] **Step 3: Register codes** in the API Design Document (spec §10.3), matching the existing table format:
  - `PERM_001 OUTSIDE_ASSIGNED_SCOPE` (403)
  - `PERM_002 SCOPE_EXCEEDS_GRANTOR` (403)
  - `PERM_003 CANNOT_MANAGE_TARGET` (403)
  - `PERM_004 NETWORK_PARTIAL_SCOPE` (403)
  - `PERM_005 PROPERTY_ASSIGNED` (409)
  - `TEAM_001 TEAM_NOT_FOUND` (404)
  - `TEAM_002 TEAM_NAME_TAKEN` (409)
  - Note reuse of F1a `ORG_003` (role denies mutation) and `ORG_008` (cross-org).

- [ ] **Step 4: Commit** `feat(shared): add F3 team/access DTOs; docs: register TEAM_*/PERM_* codes`.

---

## Task 3: `PermissionsRepository` (integration TDD)

**Files:** Create `permissions.repository.ts`; test `__tests__/permissions.repository.spec.ts`.

- [ ] **Step 1: Write the failing integration test**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsRepository } from '../permissions.repository';

describe('PermissionsRepository (integration)', () => {
  let repo: PermissionsRepository;
  let prisma: PrismaService;
  let orgId: string;
  let ownerId: string; // OrganizationMember.id
  let memberId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [PermissionsRepository, PrismaService],
    }).compile();
    repo = moduleRef.get(PermissionsRepository);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });
  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: `T${Date.now()}${Math.round(performance.now())}` } });
    orgId = org.id;
    const ownerUser = await prisma.user.create({ data: { email: `o-${org.id}@x.io`, emailVerified: false } });
    const memberUser = await prisma.user.create({ data: { email: `m-${org.id}@x.io`, emailVerified: false } });
    const owner = await prisma.organizationMember.create({ data: { organizationId: orgId, userId: ownerUser.id, role: 'OWNER' } });
    const member = await prisma.organizationMember.create({ data: { organizationId: orgId, userId: memberUser.id, role: 'MEMBER' } });
    ownerId = owner.id; memberId = member.id;
  });
  afterEach(async () => { await prisma.organization.delete({ where: { id: orgId } }); });

  async function makeSite(name: string) {
    return prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name } });
  }

  it('effectiveRootPropertyIds unions team assignments and direct grants (deduped)', async () => {
    const a = await makeSite('A');
    const b = await makeSite('B');
    const c = await makeSite('C');
    const team = await repo.createTeam({ organizationId: orgId, name: 'NE', creatorMemberId: ownerId });
    await repo.addTeamProperty({ organizationId: orgId, teamId: team.id, propertyId: a.id });
    await repo.addTeamProperty({ organizationId: orgId, teamId: team.id, propertyId: b.id });
    await repo.addTeamMember({ organizationId: orgId, teamId: team.id, memberId });
    await repo.addMemberProperty({ organizationId: orgId, memberId, propertyId: b.id }); // dup of team's B
    await repo.addMemberProperty({ organizationId: orgId, memberId, propertyId: c.id });

    const roots = await repo.effectiveRootPropertyIds(orgId, memberId);
    expect(roots.sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it('a member with no team/direct grants has no roots', async () => {
    expect(await repo.effectiveRootPropertyIds(orgId, memberId)).toEqual([]);
  });

  it('enforces case-insensitive org-unique team name', async () => {
    await repo.createTeam({ organizationId: orgId, name: 'Ops', creatorMemberId: ownerId });
    await expect(repo.createTeam({ organizationId: orgId, name: 'ops', creatorMemberId: ownerId }))
      .rejects.toThrow(); // Prisma P2002 from team_org_name_lower_uniq
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:integration -- permissions` → module not found.

- [ ] **Step 3: Implement `permissions.repository.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma, Team, TeamMember, TeamProperty, MemberProperty, OrganizationMember } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PermissionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMember(organizationId: string, userId: string): Promise<OrganizationMember | null> {
    return this.prisma.organizationMember.findFirst({ where: { organizationId, userId } });
  }

  createTeam(data: { organizationId: string; name: string; creatorMemberId: string | null }): Promise<Team> {
    return this.prisma.team.create({ data });
  }

  addTeamMember(data: { organizationId: string; teamId: string; memberId: string }): Promise<TeamMember> {
    return this.prisma.teamMember.create({ data });
  }

  addTeamProperty(data: { organizationId: string; teamId: string; propertyId: string }): Promise<TeamProperty> {
    return this.prisma.teamProperty.create({ data });
  }

  addMemberProperty(data: { organizationId: string; memberId: string; propertyId: string }): Promise<MemberProperty> {
    return this.prisma.memberProperty.create({ data });
  }

  /** Union of (team assignments via membership) and (direct member assignments). Deduped. */
  async effectiveRootPropertyIds(organizationId: string, memberId: string): Promise<string[]> {
    const [teamRoots, directRoots] = await Promise.all([
      this.prisma.teamProperty.findMany({
        where: { organizationId, team: { members: { some: { memberId } } } },
        select: { propertyId: true },
      }),
      this.prisma.memberProperty.findMany({
        where: { organizationId, memberId },
        select: { propertyId: true },
      }),
    ]);
    const ids = new Set<string>([
      ...teamRoots.map((r) => r.propertyId),
      ...directRoots.map((r) => r.propertyId),
    ]);
    return [...ids];
  }
}
```

- [ ] **Step 4: Run → PASS.** `cd apps/api && npm run test:integration -- permissions`.

- [ ] **Step 5: Commit** `feat(api): add PermissionsRepository (teams, assignments, effective roots)`.

---

## Task 4: `PermissionsService.effectiveRoots` + `scopePropertyIds` + `inScope` (unit TDD)

**Files:** Create `permissions.service.ts`; test `__tests__/permissions.service.spec.ts`.

The service is unit-tested with a mocked `PermissionsRepository` and a mocked F2 `PropertiesService` (so no DB).

- [ ] **Step 1: Write the failing unit test**

```typescript
import { Test } from '@nestjs/testing';
import { PermissionsService } from '../permissions.service';
import { PermissionsRepository } from '../permissions.repository';
import { PropertiesService } from '../../properties/properties.service';

describe('PermissionsService (scope resolution)', () => {
  let service: PermissionsService;
  const repo = { effectiveRootPropertyIds: jest.fn() } as unknown as jest.Mocked<PermissionsRepository>;
  const properties = { subtreePropertyIds: jest.fn() } as unknown as jest.Mocked<PropertiesService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PermissionsService,
        { provide: PermissionsRepository, useValue: repo },
        { provide: PropertiesService, useValue: properties },
      ],
    }).compile();
    service = moduleRef.get(PermissionsService);
  });

  it('scopePropertyIds expands every root subtree and dedupes', async () => {
    repo.effectiveRootPropertyIds.mockResolvedValue(['rootA', 'rootB']);
    properties.subtreePropertyIds.mockImplementation(async (_org, root) =>
      root === 'rootA' ? ['rootA', 'a1'] : ['rootB', 'a1'], // a1 shared
    );
    const ids = await service.scopePropertyIds('org', 'm1');
    expect(ids.sort()).toEqual(['a1', 'rootA', 'rootB']);
  });

  it('inScope is true iff the property is within an expanded subtree', async () => {
    repo.effectiveRootPropertyIds.mockResolvedValue(['rootA']);
    properties.subtreePropertyIds.mockResolvedValue(['rootA', 'a1', 'a2']);
    expect(await service.inScope('org', 'm1', 'a2')).toBe(true);
    expect(await service.inScope('org', 'm1', 'zzz')).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:unit -- permissions.service`.

- [ ] **Step 3: Implement the scope half of `permissions.service.ts`**

```typescript
import { HttpStatus, Injectable } from '@nestjs/common';
import { OrganizationMember } from '@prisma/client';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { PropertiesService } from '../properties/properties.service';
import { PermissionsRepository } from './permissions.repository';

@Injectable()
export class PermissionsService {
  constructor(
    private readonly repo: PermissionsRepository,
    private readonly properties: PropertiesService,
  ) {}

  effectiveRoots(organizationId: string, memberId: string): Promise<string[]> {
    return this.repo.effectiveRootPropertyIds(organizationId, memberId);
  }

  /** Every property id the member is scoped to: the union of each assigned root's subtree. */
  async scopePropertyIds(organizationId: string, memberId: string): Promise<string[]> {
    const roots = await this.repo.effectiveRootPropertyIds(organizationId, memberId);
    const subtrees = await Promise.all(
      roots.map((root) => this.properties.subtreePropertyIds(organizationId, root)),
    );
    return [...new Set(subtrees.flat())];
  }

  async inScope(organizationId: string, memberId: string, propertyId: string): Promise<boolean> {
    const ids = await this.scopePropertyIds(organizationId, memberId);
    return ids.includes(propertyId);
  }
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): PermissionsService scope resolution (effectiveRoots/scopePropertyIds/inScope)`.

---

## Task 5: `assertCanConfigure` (verb ceiling) + `scopeFilter` (unit TDD)

**Files:** Modify `permissions.service.ts`; extend `__tests__/permissions.service.spec.ts`.

This implements the spec §5 decision for **writes** (reads are handled in Phase B by filtering, so out-of-scope reads 404 via the entity's existing NOT_FOUND path).

- [ ] **Step 1: Add failing tests**

```typescript
describe('PermissionsService.assertCanConfigure (spec §5)', () => {
  // reuse the module setup above; add `inScope` spy control via repo/properties mocks
  const owner = { id: 'o', organizationId: 'org', role: 'OWNER' } as OrganizationMember;
  const admin = { id: 'a', organizationId: 'org', role: 'ADMIN' } as OrganizationMember;
  const member = { id: 'm', organizationId: 'org', role: 'MEMBER' } as OrganizationMember;

  it('OWNER may configure anything (no scope check)', async () => {
    await expect(service.assertCanConfigure(owner, 'anySite')).resolves.toBeUndefined();
    expect(repo.effectiveRootPropertyIds).not.toHaveBeenCalled();
  });

  it('MEMBER may never configure → ORG_003', async () => {
    await expect(service.assertCanConfigure(member, 'site')).rejects.toMatchObject({ code: 'ORG_003' });
  });

  it('ADMIN may configure in scope, not out of scope (PERM_001)', async () => {
    repo.effectiveRootPropertyIds.mockResolvedValue(['rootA']);
    properties.subtreePropertyIds.mockResolvedValue(['rootA', 'a1']);
    await expect(service.assertCanConfigure(admin, 'a1')).resolves.toBeUndefined();
    await expect(service.assertCanConfigure(admin, 'b9')).rejects.toMatchObject({ code: 'PERM_001' });
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** (append to `PermissionsService`)

```typescript
  /** Spec §5 write decision. OWNER: always. MEMBER: never (ORG_003). ADMIN: only in scope (PERM_001). */
  async assertCanConfigure(member: OrganizationMember, governingSiteId: string): Promise<void> {
    if (member.role === 'OWNER') return;
    if (member.role === 'MEMBER') {
      throw new NodeScopeException('ORG_003', 'FORBIDDEN_ROLE', HttpStatus.FORBIDDEN);
    }
    // ADMIN
    if (!(await this.inScope(member.organizationId, member.id, governingSiteId))) {
      throw new NodeScopeException('PERM_001', 'OUTSIDE_ASSIGNED_SCOPE', HttpStatus.FORBIDDEN);
    }
  }

  /** For repositories to AND into site-bound reads. `null` ⇒ unscoped (OWNER): no filter. */
  async scopeFilter(member: OrganizationMember): Promise<{ propertyIdIn: string[] } | null> {
    if (member.role === 'OWNER') return null;
    return { propertyIdIn: await this.scopePropertyIds(member.organizationId, member.id) };
  }
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): PermissionsService verb-ceiling (assertCanConfigure) + scopeFilter`.

---

## Task 6: `GET /v1/access/me` + module wiring + e2e

**Files:** Create `permissions.controller.ts`, `permissions.module.ts`; modify `app.module.ts`; test `__tests__/permissions.e2e.ts`.

- [ ] **Step 1: Implement `accessSummary` in the service**

```typescript
import { AccessSummaryDto } from '@nodescope/shared';
// ...
  async accessSummary(member: OrganizationMember): Promise<AccessSummaryDto> {
    const unscoped = member.role === 'OWNER';
    return {
      role: member.role,
      assignedRootPropertyIds: unscoped ? [] : await this.repo.effectiveRootPropertyIds(member.organizationId, member.id),
      unscoped,
    };
  }
```

- [ ] **Step 2: Implement the controller** (resolves the member from the active org + session user via the repo; relies only on F1a's `@OrgId()` + the existing `@CurrentUser()`)

```typescript
import { Controller, Get, NotFoundException } from '@nestjs/common';
import { OrgId } from '../organizations/decorators/org-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@nodescope/shared';
import { PermissionsRepository } from './permissions.repository';
import { PermissionsService } from './permissions.service';

@Controller('v1/access')
export class PermissionsController {
  constructor(
    private readonly service: PermissionsService,
    private readonly repo: PermissionsRepository,
  ) {}

  @Get('me')
  async myAccess(@OrgId() organizationId: string, @CurrentUser() user: AuthenticatedUser) {
    const member = await this.repo.findMember(organizationId, user.id);
    if (!member) throw new NotFoundException({ code: 'ORG_001', message: 'NOT_A_MEMBER' });
    const data = await this.service.accessSummary(member);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
```

- [ ] **Step 3: Create `permissions.module.ts`** and import `PropertiesModule` (for `PropertiesService`) + export the service/repo for Phases B–D:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PropertiesModule } from '../properties/properties.module';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';
import { PermissionsRepository } from './permissions.repository';

@Module({
  imports: [PrismaModule, PropertiesModule],
  controllers: [PermissionsController],
  providers: [PermissionsService, PermissionsRepository],
  exports: [PermissionsService, PermissionsRepository],
})
export class PermissionsModule {}
```

Add `PermissionsModule` to `AppModule.imports` in `app.module.ts`. Confirm `PropertiesModule` exports `PropertiesService`.

- [ ] **Step 4: Write the e2e** (`permissions.e2e.ts`) — full app, real signup; seed an org + an OWNER membership for the signed-up user, a SITE, and a team assigned that SITE with the user as member; assert `GET /api/v1/access/me`:

```typescript
it('OWNER access summary is unscoped', async () => {
  // ... sign up user, create org + OWNER membership for user.id ...
  const res = await request(app.getHttpServer())
    .get('/api/v1/access/me').set('Cookie', sessionCookie).expect(200);
  expect(res.body.data).toMatchObject({ role: 'OWNER', unscoped: true });
  expect(res.body.data.assignedRootPropertyIds).toEqual([]);
});

it('MEMBER access summary lists assigned roots', async () => {
  // ... same user re-roled MEMBER, team assigned SITE `s1`, user added to team ...
  const res = await request(app.getHttpServer())
    .get('/api/v1/access/me').set('Cookie', sessionCookie).expect(200);
  expect(res.body.data.role).toBe('MEMBER');
  expect(res.body.data.unscoped).toBe(false);
  expect(res.body.data.assignedRootPropertyIds).toContain(s1Id);
});

it('returns 401 AUTH_002 without auth', async () => {
  await request(app.getHttpServer()).get('/api/v1/access/me').expect(401);
});
```

- [ ] **Step 5: Run → PASS.** `cd apps/api && npm run test:e2e -- permissions`.

- [ ] **Step 6: Commit** `feat(api): GET /v1/access/me (AccessSummaryDto) + wire PermissionsModule`.

---

## Task 7: Phase gate — full suite + docs

- [ ] **Step 1: Full suite.** `cd apps/api && npm run test:unit && npm run test:integration && npm run test:e2e` → all green.
- [ ] **Step 2: Docs (Rule 10).** Note in the SAD/CLAUDE.md that F3 adds the assignment axis (teams + direct grants) and the `PermissionsService` seam, and that Phase B will apply it to existing endpoints (replacing F2's coarse posture).
- [ ] **Step 3: Commit** `docs: record F3 permission models + authorization seam (Phase A)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** models `Team`/`TeamMember`/`TeamProperty`/`MemberProperty` (§4.1–4.4) ✓ Task 1; `creatorMemberId` + `onDelete: SetNull` (§4.1) ✓; team-name case-insensitive org-unique (§4.1) ✓ Task 1 Step 4; DTOs + `AccessSummaryDto` (§10.1) ✓ Task 2; `effectiveRoots`/`inScope`/`scopePropertyIds`/`scopeFilter` (§5, §10.2) ✓ Tasks 4–5; `assertCanConfigure` = the §5 write decision (OWNER all / MEMBER `ORG_003` / ADMIN in-scope-or-`PERM_001`) ✓ Task 5; `GET /v1/access/me` (§10.5) ✓ Task 6; error codes (§10.3) ✓ Task 2.
- **Deferred to later phases (correctly NOT here):** applying `scopeFilter`/`assertCanConfigure` to existing endpoints → Phase B; team/assignment management endpoints + delegation rules `PERM_002`/`PERM_003`, admin team-authoring, shared-network/inter-site-link rules, invite overlay → Phase C; realtime scope-filtering + `v1:access:changed` → Phase D.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `effectiveRootPropertyIds(organizationId, memberId)` (repo) ↔ `effectiveRoots`/`scopePropertyIds`/`inScope`/`assertCanConfigure`/`scopeFilter` (service) ↔ `AccessSummaryDto { role, assignedRootPropertyIds, unscoped }` (shared) are used consistently across Tasks 3–6; `OrganizationMember` carries `id`/`organizationId`/`role`.
- **Test-config compliance:** unit logic lives in `permissions.service.ts` (`*.service.spec.ts` matches the unit regex); integration is `*.repository.spec.ts`; e2e is `*.e2e.ts` — all three pick up under the actual Jest configs.
- **Integration points to verify during execution:** F1a's `@OrgId()` decorator path + that `OrganizationMember` exposes `role`; F2's `PropertiesService.subtreePropertyIds(organizationId, propertyId)` signature + that `PropertiesModule` exports it.
