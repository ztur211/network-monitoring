# F3 Phase C — Teams, Delegation & Admin-Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the management surface — team CRUD (admins author their own scoped teams), team membership, team & direct member site-assignment endpoints — enforcing the escalation-safe delegation rules (`PERM_002`/`PERM_003`), plus the invite-authorization overlay on F1b (admins invite members only, within scope).

**Architecture:** Extend the Phase-A `permissions` module with `teams.controller.ts` and `member-assignments.controller.ts`, plus delegation helpers on `PermissionsService` and write methods on `PermissionsRepository`. The delegation invariants are pure-enough to unit-test on the service; the endpoints are covered by e2e. Two team-authority tiers (spec §7): **structure** (create/rename/delete/assign-sites — the *creating* admin only, sites ⊆ own scope) vs **membership** (add/remove members — any team wholly ⊆ the admin's scope). All targets of an admin must be `MEMBER`s.

**Tech Stack:** NestJS 11, Prisma 5, Jest (unit + integration + e2e on test DB `:5433`). No schema change (models exist from Phase A).

**Depends on:**
- **F3 Phase A** — `Team`/`TeamMember`/`TeamProperty`/`MemberProperty`, `PermissionsService` (`effectiveRoots`/`inScope`/`scopePropertyIds`/`assertCanConfigure`), `PermissionsRepository` (`findMember`, `createTeam`, `addTeamMember`, `addTeamProperty`, `addMemberProperty`, `effectiveRootPropertyIds`), `TEAM_*`/`PERM_*` codes, `AccessSummaryDto`.
- **F3 Phase B** — `@OrgMember()` decorator; scoped enforcement already live on data endpoints.
- **F1a** — `OrganizationMember`+`role`, `@OrgId()`, envelope, `NodeScopeException`, optimistic-concurrency `version`/`ChangesetChangeDto`.
- **F1b** (Task 6 only) — the invitation endpoint/service this overlays. If F1b is unbuilt, implement Tasks 1–5 and attach Task 6 when F1b lands.
- Spec: `2026-06-09-f3-team-site-verb-permissions-design.md` (§7 delegation, §10.5 endpoints).

---

## File Structure

**Create:**
- `apps/api/src/permissions/teams.controller.ts` — `/v1/teams` (+ members, + properties sub-resources)
- `apps/api/src/permissions/member-assignments.controller.ts` — `/v1/members/:memberId/{access,properties}`
- `apps/api/src/permissions/permissions.dto.ts` — request DTOs
- `apps/api/src/permissions/__tests__/permissions-delegation.service.spec.ts` (unit — matches `*.service.spec.ts`)
- `apps/api/src/permissions/__tests__/teams.e2e.ts`
- `apps/api/src/permissions/__tests__/member-assignments.e2e.ts`

**Modify:**
- `apps/api/src/permissions/permissions.service.ts` — delegation helpers + team/assignment use-cases
- `apps/api/src/permissions/permissions.repository.ts` — team reads/updates/deletes, membership/assignment removals, `findTeam`, `teamPropertyIds`
- `apps/api/src/permissions/permissions.module.ts` — register the two controllers
- (Task 6) the F1b invitations controller/service — overlay the role/scope authorization

---

## Task 1: Delegation helpers on `PermissionsService` (unit TDD)

**Files:** Modify `permissions.service.ts`; test `__tests__/permissions-delegation.service.spec.ts`.

- [ ] **Step 1: Write the failing unit tests**

```typescript
import { Test } from '@nestjs/testing';
import { PermissionsService } from '../permissions.service';
import { PermissionsRepository } from '../permissions.repository';
import { PropertiesService } from '../../properties/properties.service';
import { OrganizationMember, Team } from '@prisma/client';

describe('PermissionsService delegation (spec §7)', () => {
  let service: PermissionsService;
  const repo = { effectiveRootPropertyIds: jest.fn() } as unknown as jest.Mocked<PermissionsRepository>;
  const properties = { subtreePropertyIds: jest.fn() } as unknown as jest.Mocked<PropertiesService>;
  const owner = { id: 'o', organizationId: 'org', role: 'OWNER' } as OrganizationMember;
  const admin = { id: 'a', organizationId: 'org', role: 'ADMIN' } as OrganizationMember;
  const member = { id: 'm', organizationId: 'org', role: 'MEMBER' } as OrganizationMember;

  beforeEach(async () => {
    jest.clearAllMocks();
    const ref = await Test.createTestingModule({
      providers: [
        PermissionsService,
        { provide: PermissionsRepository, useValue: repo },
        { provide: PropertiesService, useValue: properties },
      ],
    }).compile();
    service = ref.get(PermissionsService);
    // admin scope = subtree of rootA = {rootA, a1}
    repo.effectiveRootPropertyIds.mockResolvedValue(['rootA']);
    properties.subtreePropertyIds.mockResolvedValue(['rootA', 'a1']);
  });

  it('assertWithinGrantorScope: OWNER unlimited; ADMIN ⊆ own scope; beyond → PERM_002', async () => {
    await expect(service.assertWithinGrantorScope(owner, ['anything'])).resolves.toBeUndefined();
    await expect(service.assertWithinGrantorScope(admin, ['a1'])).resolves.toBeUndefined();
    await expect(service.assertWithinGrantorScope(admin, ['rootA', 'b9'])).rejects.toMatchObject({ code: 'PERM_002' });
  });

  it('assertCanManageMember: OWNER→anyone; ADMIN→MEMBER only; ADMIN→ADMIN/OWNER → PERM_003', () => {
    expect(() => service.assertCanManageMember(owner, admin)).not.toThrow();
    expect(() => service.assertCanManageMember(admin, member)).not.toThrow();
    expect(() => service.assertCanManageMember(admin, owner)).toThrow(expect.objectContaining({ code: 'PERM_003' }));
    expect(() => service.assertCanManageMember(admin, admin)).toThrow(expect.objectContaining({ code: 'PERM_003' }));
  });

  it('assertCanManageTeamStructure: creating ADMIN with all sites in scope; non-creator or out-of-scope → PERM_003/PERM_002', async () => {
    const own = { id: 't1', creatorMemberId: 'a' } as Team;
    const other = { id: 't2', creatorMemberId: 'someoneElse' } as Team;
    await expect(service.assertCanManageTeamStructure(admin, own, ['a1'])).resolves.toBeUndefined();
    await expect(service.assertCanManageTeamStructure(admin, other, ['a1'])).rejects.toMatchObject({ code: 'PERM_003' });
    await expect(service.assertCanManageTeamStructure(admin, own, ['b9'])).rejects.toMatchObject({ code: 'PERM_002' });
    await expect(service.assertCanManageTeamStructure(owner, other, ['anywhere'])).resolves.toBeUndefined();
  });

  it('assertCanManageTeamMembership: ADMIN may manage any team wholly ⊆ scope; out-of-scope team → PERM_003', async () => {
    await expect(service.assertCanManageTeamMembership(admin, ['a1'])).resolves.toBeUndefined();
    await expect(service.assertCanManageTeamMembership(admin, ['a1', 'b9'])).rejects.toMatchObject({ code: 'PERM_003' });
    await expect(service.assertCanManageTeamMembership(owner, ['anywhere'])).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:unit -- permissions-delegation`.

- [ ] **Step 3: Implement the helpers** (append to `PermissionsService`)

```typescript
import { Team } from '@prisma/client';

/** Sites an actor may delegate = the actor's own scope. OWNER unlimited. Beyond ⇒ PERM_002. */
async assertWithinGrantorScope(actor: OrganizationMember, propertyIds: string[]): Promise<void> {
  if (actor.role === 'OWNER') return;
  for (const pid of propertyIds) {
    if (!(await this.inScope(actor.organizationId, actor.id, pid))) {
      throw new NodeScopeException('PERM_002', 'SCOPE_EXCEEDS_GRANTOR', HttpStatus.FORBIDDEN);
    }
  }
}

/** An actor may manage a target user iff OWNER (anyone) or ADMIN→MEMBER. Else PERM_003. (Role changes are OWNER-only — enforce at the call site by routing role edits through OWNER-only handlers.) */
assertCanManageMember(actor: OrganizationMember, target: OrganizationMember): void {
  if (actor.role === 'OWNER') return;
  if (actor.role === 'ADMIN' && target.role === 'MEMBER') return;
  throw new NodeScopeException('PERM_003', 'CANNOT_MANAGE_TARGET', HttpStatus.FORBIDDEN);
}

/** Structure (rename/delete/assign-sites): OWNER any; ADMIN iff they CREATED the team AND every site ⊆ their scope. */
async assertCanManageTeamStructure(actor: OrganizationMember, team: Team, teamPropertyIds: string[]): Promise<void> {
  if (actor.role === 'OWNER') return;
  if (actor.role !== 'ADMIN' || team.creatorMemberId !== actor.id) {
    throw new NodeScopeException('PERM_003', 'CANNOT_MANAGE_TARGET', HttpStatus.FORBIDDEN);
  }
  await this.assertWithinGrantorScope(actor, teamPropertyIds); // PERM_002 if any site is beyond scope
}

/** Membership (add/remove members): OWNER any; ADMIN iff the team's sites are ALL within their scope (creator or not). */
async assertCanManageTeamMembership(actor: OrganizationMember, teamPropertyIds: string[]): Promise<void> {
  if (actor.role === 'OWNER') return;
  if (actor.role !== 'ADMIN') throw new NodeScopeException('PERM_003', 'CANNOT_MANAGE_TARGET', HttpStatus.FORBIDDEN);
  for (const pid of teamPropertyIds) {
    if (!(await this.inScope(actor.organizationId, actor.id, pid))) {
      throw new NodeScopeException('PERM_003', 'CANNOT_MANAGE_TARGET', HttpStatus.FORBIDDEN);
    }
  }
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): F3 delegation helpers (grantor scope, manage-member, team structure/membership)`.

---

## Task 2: Team CRUD endpoints

**Files:** Create `teams.controller.ts`, `permissions.dto.ts`; extend `permissions.repository.ts`, `permissions.service.ts`; register in `permissions.module.ts`; test `__tests__/teams.e2e.ts`.

- [ ] **Step 1: DTOs** in `permissions.dto.ts`

```typescript
import { IsString, MinLength, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateTeamDto {
  @Transform(({ value }) => value?.trim())
  @IsString() @MinLength(1) @MaxLength(120)
  name!: string;
}

export class AddTeamMemberDto { @IsString() memberId!: string; }
export class AddTeamPropertyDto { @IsString() propertyId!: string; }
export class AddMemberPropertyDto { @IsString() propertyId!: string; }
```

(PATCH team name reuses F1a's `PatchDto { baseVersion, changes }` changeset shape, validated against `CreateTeamDto`.)

- [ ] **Step 2: Repository methods** (append)

```typescript
findTeam(organizationId: string, teamId: string): Promise<Team | null> {
  return this.prisma.team.findFirst({ where: { id: teamId, organizationId } });
}
async teamPropertyIds(organizationId: string, teamId: string): Promise<string[]> {
  const rows = await this.prisma.teamProperty.findMany({ where: { organizationId, teamId }, select: { propertyId: true } });
  return rows.map((r) => r.propertyId);
}
// Teams visible to a member = those with ≥1 assignment in scope; OWNER (scope=null) ⇒ all.
listVisibleTeams(organizationId: string, scope: { propertyIdIn: string[] } | null): Promise<Team[]> {
  return this.prisma.team.findMany({
    where: { organizationId, ...(scope && { properties: { some: { propertyId: { in: scope.propertyIdIn } } } }) },
    orderBy: { createdAt: 'asc' },
  });
}
renameTeam(organizationId: string, teamId: string, name: string, expectedVersion: number) {
  return this.prisma.team.updateMany({ where: { id: teamId, organizationId, version: expectedVersion }, data: { name, version: { increment: 1 } } });
}
deleteTeam(organizationId: string, teamId: string) {
  return this.prisma.team.deleteMany({ where: { id: teamId, organizationId } });
}
```

- [ ] **Step 3: Service use-cases** (append to `PermissionsService`)

```typescript
async createTeamFor(actor: OrganizationMember, dto: CreateTeamDto): Promise<TeamDto> {
  if (actor.role === 'MEMBER') throw new NodeScopeException('ORG_003', 'FORBIDDEN_ROLE', HttpStatus.FORBIDDEN);
  try {
    const team = await this.repo.createTeam({ organizationId: actor.organizationId, name: dto.name, creatorMemberId: actor.id });
    return toTeamDto(team);
  } catch (e) {
    if (isUniqueViolation(e)) throw new NodeScopeException('TEAM_002', 'TEAM_NAME_TAKEN', HttpStatus.CONFLICT);
    throw e;
  }
}

async renameTeamFor(actor: OrganizationMember, teamId: string, baseVersion: number, name: string): Promise<TeamDto> {
  const team = await this.loadTeamOr404(actor.organizationId, teamId);
  await this.assertCanManageTeamStructure(actor, team, await this.repo.teamPropertyIds(actor.organizationId, teamId));
  const r = await this.repo.renameTeam(actor.organizationId, teamId, name, baseVersion);
  if (r.count === 0) throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);
  return toTeamDto(await this.loadTeamOr404(actor.organizationId, teamId));
}

async deleteTeamFor(actor: OrganizationMember, teamId: string): Promise<void> {
  const team = await this.loadTeamOr404(actor.organizationId, teamId);
  await this.assertCanManageTeamStructure(actor, team, await this.repo.teamPropertyIds(actor.organizationId, teamId));
  await this.repo.deleteTeam(actor.organizationId, teamId); // cascades memberships + assignments (Phase A onDelete)
}

private async loadTeamOr404(organizationId: string, teamId: string): Promise<Team> {
  const team = await this.repo.findTeam(organizationId, teamId);
  if (!team) throw new NodeScopeException('TEAM_001', 'TEAM_NOT_FOUND', HttpStatus.NOT_FOUND);
  return team;
}
```

(`toTeamDto` maps the Prisma row to `TeamDto`; `isUniqueViolation(e)` checks `e.code === 'P2002'`.)

- [ ] **Step 4: Controller** `teams.controller.ts`

```typescript
@Controller('v1/teams')
export class TeamsController {
  constructor(private readonly service: PermissionsService) {}

  @Get()
  async list(@OrgMember() member: OrganizationMember) {
    const data = await this.service.listTeams(member); // applies scopeFilter + listVisibleTeams
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@OrgMember() member: OrganizationMember, @Body() dto: CreateTeamDto) {
    return { success: true, data: await this.service.createTeamFor(member, dto), timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  async rename(@OrgMember() member: OrganizationMember, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PatchDto) {
    const name = applyNameChangeset(dto); // pulls the `name` change out of the changeset
    return { success: true, data: await this.service.renameTeamFor(member, id, dto.baseVersion, name), timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@OrgMember() member: OrganizationMember, @Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteTeamFor(member, id);
  }
}
```

- [ ] **Step 5: Write the e2e** (`teams.e2e.ts`): ADMIN assigned `sA` creates a team (201, `creatorMemberId` = the admin); MEMBER create → 403 `ORG_003`; duplicate name → 409 `TEAM_002`; ADMIN renames own team (200) but another admin's/owner's team → 403 `PERM_003`; OWNER renames any.

- [ ] **Step 6: Run → PASS.** `cd apps/api && npm run test:e2e -- teams`. Register `TeamsController` in `permissions.module.ts`.

- [ ] **Step 7: Commit** `feat(api): team CRUD endpoints (admin-authored, OWNER/creator-managed)`.

---

## Task 3: Team membership endpoints

**Files:** Modify `teams.controller.ts`, `permissions.service.ts`, `permissions.repository.ts`; test `teams.e2e.ts`.

- [ ] **Step 1: Repository** — `addTeamMember` exists (Phase A); add `removeTeamMember` + `findMemberById`:

```typescript
removeTeamMember(organizationId: string, teamId: string, memberId: string) {
  return this.prisma.teamMember.deleteMany({ where: { organizationId, teamId, memberId } });
}
findMemberById(organizationId: string, memberId: string): Promise<OrganizationMember | null> {
  return this.prisma.organizationMember.findFirst({ where: { id: memberId, organizationId } });
}
```

- [ ] **Step 2: Service** — membership use-cases enforcing team-in-scope + target-is-member:

```typescript
async addMemberToTeam(actor: OrganizationMember, teamId: string, memberId: string): Promise<TeamMemberDto> {
  await this.loadTeamOr404(actor.organizationId, teamId);
  await this.assertCanManageTeamMembership(actor, await this.repo.teamPropertyIds(actor.organizationId, teamId));
  const target = await this.repo.findMemberById(actor.organizationId, memberId);
  if (!target) throw new NodeScopeException('ORG_001', 'NOT_A_MEMBER', HttpStatus.NOT_FOUND);
  this.assertCanManageMember(actor, target); // ADMIN may only add MEMBERs
  const tm = await this.repo.addTeamMember({ organizationId: actor.organizationId, teamId, memberId });
  return { id: tm.id, teamId, memberId };
}

async removeMemberFromTeam(actor: OrganizationMember, teamId: string, memberId: string): Promise<void> {
  await this.loadTeamOr404(actor.organizationId, teamId);
  await this.assertCanManageTeamMembership(actor, await this.repo.teamPropertyIds(actor.organizationId, teamId));
  const target = await this.repo.findMemberById(actor.organizationId, memberId);
  if (target) this.assertCanManageMember(actor, target);
  await this.repo.removeTeamMember(actor.organizationId, teamId, memberId);
}
```

- [ ] **Step 3: Controller** — sub-resource handlers on `TeamsController`:

```typescript
@Post(':id/members')
@HttpCode(HttpStatus.CREATED)
async addMember(@OrgMember() m: OrganizationMember, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddTeamMemberDto) {
  return { success: true, data: await this.service.addMemberToTeam(m, id, dto.memberId), timestamp: new Date().toISOString() };
}

@Delete(':id/members/:memberId')
@HttpCode(HttpStatus.NO_CONTENT)
async removeMember(@OrgMember() m: OrganizationMember, @Param('id', ParseUUIDPipe) id: string, @Param('memberId', ParseUUIDPipe) memberId: string) {
  await this.service.removeMemberFromTeam(m, id, memberId);
}
```

- [ ] **Step 4: e2e** — ADMIN assigned `sA` adds a MEMBER to a team whose sites ⊆ `sA` (201); adds a member to a team that also covers `sB` (not in admin scope) → 403 `PERM_003`; adds an ADMIN target → 403 `PERM_003`; OWNER adds anyone to any team.

- [ ] **Step 5: Run → PASS.** Commit `feat(api): team membership endpoints with scoped, member-only delegation`.

---

## Task 4: Team site-assignment endpoints

**Files:** Modify `teams.controller.ts`, `permissions.service.ts`, `permissions.repository.ts`; test `teams.e2e.ts`.

- [ ] **Step 1: Repository** — `addTeamProperty` exists (Phase A); add `removeTeamProperty`:

```typescript
removeTeamProperty(organizationId: string, teamId: string, propertyId: string) {
  return this.prisma.teamProperty.deleteMany({ where: { organizationId, teamId, propertyId } });
}
```

- [ ] **Step 2: Service** — assigning a site is **structure** (creator-only) AND the new site must be ⊆ scope:

```typescript
async assignSiteToTeam(actor: OrganizationMember, teamId: string, propertyId: string): Promise<TeamPropertyDto> {
  const team = await this.loadTeamOr404(actor.organizationId, teamId);
  const current = await this.repo.teamPropertyIds(actor.organizationId, teamId);
  await this.assertCanManageTeamStructure(actor, team, current);          // creator + existing sites ⊆ scope
  await this.assertWithinGrantorScope(actor, [propertyId]);               // new site ⊆ scope (PERM_002)
  const tp = await this.repo.addTeamProperty({ organizationId: actor.organizationId, teamId, propertyId });
  return { id: tp.id, teamId, propertyId };
}

async unassignSiteFromTeam(actor: OrganizationMember, teamId: string, propertyId: string): Promise<void> {
  const team = await this.loadTeamOr404(actor.organizationId, teamId);
  await this.assertCanManageTeamStructure(actor, team, await this.repo.teamPropertyIds(actor.organizationId, teamId));
  await this.repo.removeTeamProperty(actor.organizationId, teamId, propertyId);
}
```

- [ ] **Step 3: Controller** — `@Post(':id/properties')` / `@Delete(':id/properties/:propertyId')` on `TeamsController`, mirroring Task 3's shape with `AddTeamPropertyDto`.

- [ ] **Step 4: e2e** — creating ADMIN (assigned `sA`) assigns `sA`-subtree site to their team (201); assigns `sB` (beyond scope) → 403 `PERM_002`; a non-creator ADMIN assigns to that team → 403 `PERM_003`; OWNER assigns any site to any team.

- [ ] **Step 5: Run → PASS.** Commit `feat(api): team site-assignment endpoints (creator + ⊆-scope, PERM_002)`.

---

## Task 5: Direct member assignment + in-scope-slice access view

**Files:** Create `member-assignments.controller.ts`; modify `permissions.service.ts`, `permissions.repository.ts`; register in module; test `member-assignments.e2e.ts`.

- [ ] **Step 1: Repository** — direct-grant reads/removes (`addMemberProperty` exists):

```typescript
removeMemberProperty(organizationId: string, memberId: string, propertyId: string) {
  return this.prisma.memberProperty.deleteMany({ where: { organizationId, memberId, propertyId } });
}
```

- [ ] **Step 2: Service** — direct grant + the in-scope-slice access view (spec §7):

```typescript
async grantSiteToMember(actor: OrganizationMember, memberId: string, propertyId: string): Promise<MemberPropertyDto> {
  const target = await this.repo.findMemberById(actor.organizationId, memberId);
  if (!target) throw new NodeScopeException('ORG_001', 'NOT_A_MEMBER', HttpStatus.NOT_FOUND);
  this.assertCanManageMember(actor, target);                 // ADMIN → MEMBER only (PERM_003)
  await this.assertWithinGrantorScope(actor, [propertyId]);  // site ⊆ actor scope (PERM_002)
  const mp = await this.repo.addMemberProperty({ organizationId: actor.organizationId, memberId, propertyId });
  return { id: mp.id, memberId, propertyId };
}

async revokeSiteFromMember(actor: OrganizationMember, memberId: string, propertyId: string): Promise<void> {
  const target = await this.repo.findMemberById(actor.organizationId, memberId);
  if (target) this.assertCanManageMember(actor, target);
  await this.assertWithinGrantorScope(actor, [propertyId]);  // can only revoke within own scope
  await this.repo.removeMemberProperty(actor.organizationId, memberId, propertyId);
}

/** A target member's access AS SEEN BY the actor: OWNER sees all roots; an ADMIN sees only the slice ⊆ their own scope. */
async memberAccessAsSeenBy(actor: OrganizationMember, memberId: string): Promise<AccessSummaryDto> {
  const target = await this.repo.findMemberById(actor.organizationId, memberId);
  if (!target) throw new NodeScopeException('ORG_001', 'NOT_A_MEMBER', HttpStatus.NOT_FOUND);
  this.assertCanManageMember(actor, target);
  const roots = await this.repo.effectiveRootPropertyIds(actor.organizationId, memberId);
  if (actor.role === 'OWNER') return { role: target.role, assignedRootPropertyIds: roots, unscoped: false };
  const actorScope = new Set(await this.scopePropertyIds(actor.organizationId, actor.id));
  return { role: target.role, assignedRootPropertyIds: roots.filter((r) => actorScope.has(r)), unscoped: false };
}
```

- [ ] **Step 3: Controller** `member-assignments.controller.ts`

```typescript
@Controller('v1/members/:memberId')
export class MemberAssignmentsController {
  constructor(private readonly service: PermissionsService) {}

  @Get('access')
  async access(@OrgMember() actor: OrganizationMember, @Param('memberId', ParseUUIDPipe) memberId: string) {
    return { success: true, data: await this.service.memberAccessAsSeenBy(actor, memberId), timestamp: new Date().toISOString() };
  }

  @Post('properties')
  @HttpCode(HttpStatus.CREATED)
  async grant(@OrgMember() actor: OrganizationMember, @Param('memberId', ParseUUIDPipe) memberId: string, @Body() dto: AddMemberPropertyDto) {
    return { success: true, data: await this.service.grantSiteToMember(actor, memberId, dto.propertyId), timestamp: new Date().toISOString() };
  }

  @Delete('properties/:propertyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@OrgMember() actor: OrganizationMember, @Param('memberId', ParseUUIDPipe) memberId: string, @Param('propertyId', ParseUUIDPipe) propertyId: string) {
    await this.service.revokeSiteFromMember(actor, memberId, propertyId);
  }
}
```

- [ ] **Step 4: e2e** (`member-assignments.e2e.ts`) — ADMIN (assigned `sA`) grants `sA` to a MEMBER (201); grants `sB` → 403 `PERM_002`; grants to an ADMIN target → 403 `PERM_003`; `GET .../access` as the ADMIN returns only the in-scope slice of a member who also holds `sB` (so `sB` is hidden); OWNER sees the full set.

- [ ] **Step 5: Run → PASS.** Register `MemberAssignmentsController` in the module. Commit `feat(api): direct member site-grants + in-scope-slice access view`.

---

## Task 6: Invite-authorization overlay (on F1b)

**Files:** Modify the F1b invitations controller/service; test (extend F1b's invite e2e).

> Requires F1b. If F1b is unbuilt, defer this task and attach it when F1b lands; Tasks 1–5 stand alone.

- [ ] **Step 1: Write the failing e2e** — ADMIN (assigned `sA`) creates an invitation at role `MEMBER` (success); at role `ADMIN` → 403 `PERM_003`; OWNER may invite at any role.

```typescript
it('ADMIN may invite MEMBER, not ADMIN; OWNER may invite ADMIN', async () => {
  await request(server).post('/api/v1/invitations').set('Cookie', adminCookie)
    .send({ email: 'new@x.io', role: 'MEMBER' }).expect(201);
  const denied = await request(server).post('/api/v1/invitations').set('Cookie', adminCookie)
    .send({ email: 'boss@x.io', role: 'ADMIN' }).expect(403);
  expect(denied.body.error.code).toBe('PERM_003');
  await request(server).post('/api/v1/invitations').set('Cookie', ownerCookie)
    .send({ email: 'admin2@x.io', role: 'ADMIN' }).expect(201);
});
```

- [ ] **Step 2: Overlay the rule** in the F1b invitation service (before creating the invite):

```typescript
// actor = current OrganizationMember; dto.role = invited role
if (actor.role !== 'OWNER' && dto.role !== 'MEMBER') {
  throw new NodeScopeException('PERM_003', 'CANNOT_MANAGE_TARGET', HttpStatus.FORBIDDEN);
}
if (actor.role === 'MEMBER') {
  throw new NodeScopeException('ORG_003', 'FORBIDDEN_ROLE', HttpStatus.FORBIDDEN);
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(api): invite-authorization overlay (admins invite MEMBER only; owner any role)`.

---

## Task 7: Audit + realtime events for team/assignment mutations

**Files:** Modify `permissions.service.ts` (inject F1a's `AuditService` + the realtime service); extend `teams.e2e.ts`.

Every team/assignment mutation must (a) write a `ChangeLog` row via `AuditService` and (b) emit its WS event (spec §10.4, §11). Pre-Phase-D these use the existing emit path; Phase D refolds them into the scoped fan-out.

- [ ] **Step 1: Audit.** In each use-case (`createTeamFor`/`renameTeamFor`/`deleteTeamFor`/`addMemberToTeam`/`removeMemberFromTeam`/`assignSiteToTeam`/`unassignSiteFromTeam`/`grantSiteToMember`/`revokeSiteFromMember`) call the matching `AuditService.recordCreate/recordUpdate/recordDelete` with `entityType` `'Team'`/`'TeamMember'`/`'TeamProperty'`/`'MemberProperty'`, actor `actor.id`, and the org. (Phase A Task 1 Step 4 already extended the `ChangeLog` CHECK to accept these.)
- [ ] **Step 2: Events.** Emit the matching `WS_EVENTS` constant (Phase A Task 2) on each mutation: `TEAM_CREATED/UPDATED/DELETED`, `TEAM_MEMBER_ADDED/REMOVED`, `TEAM_PROPERTY_ASSIGNED/UNASSIGNED`, `MEMBER_PROPERTY_ASSIGNED/UNASSIGNED`.
- [ ] **Step 3: Test.** Extend a team e2e to assert a `ChangeLog` row is written on team create (query via Prisma); WS delivery assertions are deferred to Phase D. `cd apps/api && npm run test:e2e -- teams` → PASS.
- [ ] **Step 4: Commit** `feat(api): audit + lifecycle events for team/assignment mutations`.

---

## Task 8: Phase gate + docs

- [ ] **Step 1: Full suite.** `cd apps/api && npm run test:unit && npm run test:integration && npm run test:e2e` → all green.
- [ ] **Step 2: Property-delete guard (`PERM_005`).** Confirm `PropertiesService.deleteProperty` (Phase B / F2) blocks deleting a site that is assigned to any team or member with `PERM_005 PROPERTY_ASSIGNED` (the `onDelete: Restrict` from Phase A surfaces as a guarded check, mirroring F2's `PROP_004`). Add an e2e if not already covered.
- [ ] **Step 3: Docs (Rule 10).** Update the API Design Document with the `/v1/teams*`, `/v1/members/:id/{access,properties}` endpoints; SAD with the delegation model (two team-authority tiers, in-scope-slice).
- [ ] **Step 4: Commit** `docs: F3 teams/delegation endpoints + delegation model`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** team CRUD with admin authoring + `creatorMemberId` (§7) ✓ Task 2; team membership, member-only + team-in-scope (§7) ✓ Task 3; team site-assignment, creator + ⊆-scope `PERM_002` (§7) ✓ Task 4; direct member grants + in-scope-slice access view (§7) ✓ Task 5; `assertCanManageMember`/`PERM_003`, role-change OWNER-only (§7) ✓ Task 1; invite overlay (§7/§10.5) ✓ Task 6; team/assignment audit + lifecycle WS events (§10.4/§11) ✓ Task 7; `TEAM_001`/`TEAM_002` (§10.3) ✓ Task 2; `PERM_005` property-assigned delete-block (§4.5/§10.3) ✓ Task 8.
- **Two team-authority tiers correctly separated:** structure (creator-only, `assertCanManageTeamStructure`) vs membership (any in-scope team, `assertCanManageTeamMembership`) — Tasks 3 vs 4.
- **Placeholder scan:** none; helper stubs (`toTeamDto`, `isUniqueViolation`, `applyNameChangeset`) specified in prose with exact behavior.
- **Type consistency:** `assertWithinGrantorScope`/`assertCanManageMember`/`assertCanManageTeamStructure`/`assertCanManageTeamMembership` (Task 1) consumed verbatim across Tasks 2–6; `OrganizationMember`(`id`/`organizationId`/`role`/`creatorMemberId` on `Team`); DTOs `TeamDto`/`TeamMemberDto`/`TeamPropertyDto`/`MemberPropertyDto`/`AccessSummaryDto` match Phase A.
- **Test-config compliance:** unit logic in `*.service.spec.ts`; e2e in `*.e2e.ts`.
- **Integration points to verify during execution:** F1b's invitation endpoint path + DTO (`role` field) for Task 6; F1a's `PatchDto`/changeset shape reused for team rename; that Phase B's property delete-block is the right place to add `PERM_005`.
