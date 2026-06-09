# F1b — Membership Growth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an organization grow its own team — admin invitations (shareable link), domain-matched request-to-join, and member management (role change / removal) with an authority model and last-owner protection.

**Architecture:** Two additive models (`Invitation`, `JoinRequest`) and new services/controllers on top of F1a's `OrganizationsModule`. Admin endpoints reuse F1a's `OrgContextGuard` + `OrgRoleGuard` (`@OrgRoles('OWNER','ADMIN')`); the accept-invite and submit-request endpoints use `AuthGuard` only (the actor isn't a member yet). All actor/email/org data comes from the session.

**Tech Stack:** NestJS, Prisma 5, PostgreSQL, Jest (test DB `:5433`). `NodeScopeException`, repository pattern, TDD.

**Depends on:** F1a fully implemented (`Organization`/`OrganizationDomain`/`OrganizationMember`, `OrganizationsRepository`, `OrgContextGuard`, `OrgRoleGuard`, `@OrgId`, `@OrgRoles`, `OrganizationsService`). Spec: `docs/superpowers/specs/2026-06-06-f1b-membership-growth-design.md`.

> If Phase B has been merged, `OrgContextGuard` is a global `APP_GUARD`; in that case omit it from per-controller `@UseGuards` (keep `AuthGuard` + `OrgRoleGuard`). Both forms are functionally correct.

---

## File Structure

**Create:**
- `apps/api/src/organizations/invitations.repository.ts`
- `apps/api/src/organizations/invitations.service.ts`
- `apps/api/src/organizations/invitations.controller.ts` (admin: create/list/revoke, under `/v1/organizations/me/invitations`)
- `apps/api/src/organizations/invitation-accept.controller.ts` (under `/v1/invitations`, AuthGuard only)
- `apps/api/src/organizations/join-requests.repository.ts`
- `apps/api/src/organizations/join-requests.service.ts`
- `apps/api/src/organizations/join-requests.controller.ts` (admin: list/approve/deny)
- `apps/api/src/organizations/join-request-submit.controller.ts` (under `/v1/join-requests`, AuthGuard only)
- `apps/api/src/organizations/members.controller.ts` (role change / removal, under `/v1/organizations/me/members`)
- `apps/api/src/organizations/membership.dto.ts` (request DTOs)
- `__tests__/` specs for each service + e2e for the controllers

**Modify:**
- `apps/api/prisma/schema.prisma` — add `Invitation`, `JoinRequest`, `JoinRequestStatus`
- `apps/api/src/organizations/organizations.repository.ts` — add member-management queries (`updateMemberRole`, `deleteMember`, `countOwners`)
- `apps/api/src/organizations/organizations.service.ts` — add `changeMemberRole`, `removeMember`
- `apps/api/src/organizations/organizations.module.ts` — register new providers/controllers
- `packages/shared/src/types/api.types.ts` — `InvitationDto`, `InvitationLinkDto`, `JoinRequestDto`
- `packages/shared/src/types/realtime.types.ts` — invitation/join-request WS events

---

## Task 1: Schema — `Invitation`, `JoinRequest`, `JoinRequestStatus`

**Files:** Modify `apps/api/prisma/schema.prisma`; generated migration.

- [ ] **Step 1: Add the enum and models** (copy from spec §4):

```prisma
enum JoinRequestStatus { PENDING APPROVED DENIED }

model Invitation {
  id              String   @id @default(uuid())
  organizationId  String
  email           String
  role            OrgRole  @default(MEMBER)
  token           String   @unique
  expiresAt       DateTime
  invitedByUserId String?
  acceptedAt      DateTime?
  createdAt       DateTime @default(now())
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@index([organizationId])
  @@index([email])
}

model JoinRequest {
  id              String            @id @default(uuid())
  organizationId  String
  userId          String
  status          JoinRequestStatus @default(PENDING)
  decidedByUserId String?
  decidedAt       DateTime?
  createdAt       DateTime          @default(now())
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([organizationId, status])
  @@index([userId])
}
```

Add back-relations: `Organization { invitations Invitation[]  joinRequests JoinRequest[] }` and `User { joinRequests JoinRequest[] }`.

- [ ] **Step 2: Migrate.** `cd apps/api && npx prisma migrate dev --name f1b_membership_growth` → applies cleanly, client regenerates.
- [ ] **Step 3: `npx tsc --noEmit`** → PASS.
- [ ] **Step 4: Commit** `feat(api): add Invitation and JoinRequest models`.

---

## Task 2: Shared DTOs, WS events, error-code registration

**Files:** Modify `packages/shared/src/types/api.types.ts`, `realtime.types.ts`; API Design Document.

- [ ] **Step 1: Add DTOs to `api.types.ts`**

```typescript
export interface InvitationDto { id: string; email: string; role: OrgRole; expiresAt: string; acceptedAt: string | null; createdAt: string; }
export interface InvitationLinkDto { invitation: InvitationDto; token: string; url: string; }
export type JoinRequestStatus = 'PENDING' | 'APPROVED' | 'DENIED';
export interface JoinRequestDto { id: string; organizationId: string; userId: string; status: JoinRequestStatus; createdAt: string; decidedAt: string | null; }
```

- [ ] **Step 2: Add WS event constants to `realtime.types.ts`**

```typescript
ORG_INVITATION_CREATED: 'v1:org:invitation:created',
ORG_INVITATION_REVOKED: 'v1:org:invitation:revoked',
ORG_INVITATION_ACCEPTED: 'v1:org:invitation:accepted',
ORG_JOIN_REQUEST_CREATED: 'v1:org:joinRequest:created',
ORG_JOIN_REQUEST_DECIDED: 'v1:org:joinRequest:decided',
```

- [ ] **Step 3: Build shared.** `cd packages/shared && npm run build` → PASS.
- [ ] **Step 4: Register `ORG_009`–`ORG_015`** in the API Design Document (spec §8.2), matching the existing table format.
- [ ] **Step 5: Commit** `feat(shared): add membership DTOs, WS events; docs: register ORG_009-015`.

---

## Task 3: Repositories — invitations, join-requests, member management

**Files:** Create `invitations.repository.ts`, `join-requests.repository.ts`; modify `organizations.repository.ts`; integration test.

- [ ] **Step 1: Write the failing integration test** covering: create+find invitation by token; find pending invitation by `(orgId, email)`; create+find join request; `countOwners`. (Mirror Phase A's `organizations.repository.spec.ts` structure — connect PrismaService, seed an org, assert, clean up.)

- [ ] **Step 2: Run → FAIL** (`cd apps/api && npm run test:integration -- invitations.repository`).

- [ ] **Step 3: Implement `InvitationsRepository`**

```typescript
@Injectable()
export class InvitationsRepository {
  constructor(private readonly prisma: PrismaService) {}
  create(data: { organizationId: string; email: string; role: OrgRole; token: string; expiresAt: Date; invitedByUserId: string | null }): Promise<Invitation> {
    return this.prisma.invitation.create({ data });
  }
  findByToken(token: string): Promise<Invitation | null> {
    return this.prisma.invitation.findUnique({ where: { token } });
  }
  findPendingByOrgAndEmail(organizationId: string, email: string): Promise<Invitation | null> {
    return this.prisma.invitation.findFirst({ where: { organizationId, email, acceptedAt: null } });
  }
  listPending(organizationId: string): Promise<Invitation[]> {
    return this.prisma.invitation.findMany({ where: { organizationId, acceptedAt: null }, orderBy: { createdAt: 'desc' } });
  }
  deletePendingByOrgAndEmail(organizationId: string, email: string): Promise<Prisma.BatchPayload> {
    return this.prisma.invitation.deleteMany({ where: { organizationId, email, acceptedAt: null } });
  }
  deleteByIdAndOrg(id: string, organizationId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.invitation.deleteMany({ where: { id, organizationId, acceptedAt: null } });
  }
  markAccepted(id: string): Promise<Invitation> {
    return this.prisma.invitation.update({ where: { id }, data: { acceptedAt: new Date() } });
  }
}
```

- [ ] **Step 4: Implement `JoinRequestsRepository`**

```typescript
@Injectable()
export class JoinRequestsRepository {
  constructor(private readonly prisma: PrismaService) {}
  create(organizationId: string, userId: string): Promise<JoinRequest> {
    return this.prisma.joinRequest.create({ data: { organizationId, userId } });
  }
  findPendingByUser(userId: string): Promise<JoinRequest | null> {
    return this.prisma.joinRequest.findFirst({ where: { userId, status: 'PENDING' } });
  }
  findByIdAndOrg(id: string, organizationId: string): Promise<JoinRequest | null> {
    return this.prisma.joinRequest.findFirst({ where: { id, organizationId } });
  }
  listByOrgAndStatus(organizationId: string, status: JoinRequestStatus): Promise<JoinRequest[]> {
    return this.prisma.joinRequest.findMany({ where: { organizationId, status }, orderBy: { createdAt: 'desc' } });
  }
  decide(id: string, status: JoinRequestStatus, decidedByUserId: string): Promise<JoinRequest> {
    return this.prisma.joinRequest.update({ where: { id }, data: { status, decidedByUserId, decidedAt: new Date() } });
  }
}
```

- [ ] **Step 5: Add member-management methods to `OrganizationsRepository`**

```typescript
findMemberByUserAndOrg(userId: string, organizationId: string): Promise<OrganizationMember | null> {
  return this.prisma.organizationMember.findFirst({ where: { userId, organizationId } });
}
updateMemberRole(userId: string, organizationId: string, role: OrgRole): Promise<Prisma.BatchPayload> {
  return this.prisma.organizationMember.updateMany({ where: { userId, organizationId }, data: { role } });
}
deleteMember(userId: string, organizationId: string): Promise<Prisma.BatchPayload> {
  return this.prisma.organizationMember.deleteMany({ where: { userId, organizationId } });
}
countOwners(organizationId: string): Promise<number> {
  return this.prisma.organizationMember.count({ where: { organizationId, role: 'OWNER' } });
}
```

- [ ] **Step 6: Run → PASS.** Commit `feat(api): add invitation/join-request/member-management repositories`.

---

## Task 4: Invitations service + controllers

**Files:** Create `invitations.service.ts`, `invitations.controller.ts`, `invitation-accept.controller.ts`, `membership.dto.ts`; test `__tests__/invitations.service.spec.ts`.

- [ ] **Step 1: DTOs** (`membership.dto.ts`)

```typescript
import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';
import { OrgRole } from '@prisma/client';

export class CreateInvitationDto { @IsEmail() email: string; @IsEnum(OrgRole) role: OrgRole; }
export class AcceptInvitationDto { @IsString() @MinLength(1) token: string; }
export class ChangeMemberRoleDto { @IsEnum(OrgRole) role: OrgRole; }
```

- [ ] **Step 2: Write the failing service test** — assert: create replaces a prior pending invite and returns a token+url; accept with mismatched email → `ORG_010`; expired token → `ORG_009`; already-a-member → `ORG_011`; happy-path accept creates a member and marks accepted. (Mock `InvitationsRepository`, `OrganizationsRepository`; for "now", inject a clock or pass `expiresAt` so the test controls expiry — see Step 3.)

- [ ] **Step 3: Implement `InvitationsService`**

```typescript
import { HttpStatus, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { OrgRole } from '@prisma/client';
import { InvitationsRepository } from './invitations.repository';
import { OrganizationsRepository } from './organizations.repository';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict-resolution.service';
import { WS_EVENTS } from '@nodescope/shared';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class InvitationsService {
  constructor(
    private readonly invitations: InvitationsRepository,
    private readonly orgs: OrganizationsRepository,
    private readonly realtime: ConflictResolutionService,
  ) {}

  async create(organizationId: string, email: string, role: OrgRole, invitedByUserId: string) {
    const normalized = email.trim().toLowerCase();
    await this.invitations.deletePendingByOrgAndEmail(organizationId, normalized);
    const token = randomBytes(32).toString('base64url');
    const invitation = await this.invitations.create({
      organizationId, email: normalized, role, token,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS), invitedByUserId,
    });
    this.realtime.emitEntityEvent(WS_EVENTS.ORG_INVITATION_CREATED, { id: invitation.id, email: normalized }, organizationId);
    return { invitation, token };
  }

  listPending(organizationId: string) { return this.invitations.listPending(organizationId); }

  async revoke(organizationId: string, id: string) {
    const res = await this.invitations.deleteByIdAndOrg(id, organizationId);
    if (res.count === 0) throw new NodeScopeException('ORG_009', 'INVITATION_INVALID', HttpStatus.NOT_FOUND);
    this.realtime.emitEntityEvent(WS_EVENTS.ORG_INVITATION_REVOKED, { id }, organizationId);
  }

  async accept(userId: string, userEmail: string, token: string) {
    const invitation = await this.invitations.findByToken(token);
    if (!invitation || invitation.acceptedAt || invitation.expiresAt.getTime() < Date.now()) {
      throw new NodeScopeException('ORG_009', 'INVITATION_INVALID', HttpStatus.NOT_FOUND);
    }
    if (invitation.email !== userEmail.trim().toLowerCase()) {
      throw new NodeScopeException('ORG_010', 'INVITATION_EMAIL_MISMATCH', HttpStatus.FORBIDDEN);
    }
    if (await this.orgs.findMemberByUserId(userId)) {
      throw new NodeScopeException('ORG_011', 'ALREADY_A_MEMBER', HttpStatus.CONFLICT);
    }
    await this.orgs.createMember(userId, invitation.organizationId, invitation.role);
    await this.invitations.markAccepted(invitation.id);
    this.realtime.emitEntityEvent(WS_EVENTS.ORG_MEMBER_ADDED, { userId, role: invitation.role }, invitation.organizationId);
    this.realtime.emitEntityEvent(WS_EVENTS.ORG_INVITATION_ACCEPTED, { id: invitation.id, userId }, invitation.organizationId);
  }
}
```

(`emitEntityEvent`'s third arg is the org id — matches Phase D's signature; if F1b lands before Phase D, it currently takes a user id, so pass the org id and update once Phase D lands, or coordinate ordering.)

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Controllers**

`invitations.controller.ts` (admin):

```typescript
@Controller('v1/organizations/me/invitations')
@UseGuards(AuthGuard, OrgContextGuard, OrgRoleGuard)
@OrgRoles('OWNER', 'ADMIN')
export class InvitationsController {
  constructor(private readonly service: InvitationsService, private readonly config: ConfigService) {}

  @Post()
  async create(@OrgId() orgId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInvitationDto) {
    const { invitation, token } = await this.service.create(orgId, dto.email, dto.role, user.id);
    const url = `${this.config.get('APP_URL')}/invite/${token}`;
    return { success: true, data: { invitation: toInvitationDto(invitation), token, url }, timestamp: new Date().toISOString() };
  }

  @Get()
  async list(@OrgId() orgId: string) {
    const items = await this.service.listPending(orgId);
    return { success: true, data: items.map(toInvitationDto), timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  async revoke(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.service.revoke(orgId, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
```

`invitation-accept.controller.ts` (AuthGuard only — actor isn't a member yet):

```typescript
@Controller('v1/invitations')
@UseGuards(AuthGuard)
export class InvitationAcceptController {
  constructor(private readonly service: InvitationsService) {}

  @Post('accept')
  async accept(@CurrentUser() user: AuthenticatedUser, @Body() dto: AcceptInvitationDto) {
    await this.service.accept(user.id, user.email, dto.token);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
```

Confirm `AuthenticatedUser` exposes `email` (it should, from the Better Auth session). Add a `toInvitationDto` mapper. Confirm the config key for the app URL (`APP_URL` or similar) against the existing `ConfigService` usage.

- [ ] **Step 6: e2e** — admin creates an invite (asserts a token+url returned); a user with the matching email accepts and becomes a member; a mismatched-email accept → 403 `ORG_010`. (Use the Phase A e2e auth-override with a mutable `currentUser`.)

- [ ] **Step 7: Commit** `feat(api): invitations (create/list/revoke/accept)`.

---

## Task 5: Join-requests service + controllers

**Files:** Create `join-requests.service.ts`, `join-requests.controller.ts`, `join-request-submit.controller.ts`; test.

- [ ] **Step 1: Write the failing service test** — submit resolves org by domain; no domain match → `ORG_014`; duplicate pending → `ORG_015`; already-a-member → `ORG_011`; approve creates a MEMBER + marks APPROVED; deny marks DENIED.

- [ ] **Step 2: Implement `JoinRequestsService`**

```typescript
@Injectable()
export class JoinRequestsService {
  constructor(
    private readonly requests: JoinRequestsRepository,
    private readonly orgs: OrganizationsRepository,
    private readonly realtime: ConflictResolutionService,
  ) {}

  async submit(userId: string, userEmail: string) {
    if (await this.orgs.findMemberByUserId(userId)) throw new NodeScopeException('ORG_011', 'ALREADY_A_MEMBER', HttpStatus.CONFLICT);
    const domain = userEmail.split('@')[1]?.toLowerCase() ?? '';
    const match = await this.orgs.findOrganizationByDomain(domain);
    if (!match) throw new NodeScopeException('ORG_014', 'NO_MATCHING_ORG_FOR_DOMAIN', HttpStatus.NOT_FOUND);
    if (await this.requests.findPendingByUser(userId)) throw new NodeScopeException('ORG_015', 'DUPLICATE_JOIN_REQUEST', HttpStatus.CONFLICT);
    const req = await this.requests.create(match.organization.id, userId);
    this.realtime.emitEntityEvent(WS_EVENTS.ORG_JOIN_REQUEST_CREATED, { id: req.id, userId }, match.organization.id);
    return req;
  }

  list(organizationId: string, status: JoinRequestStatus) { return this.requests.listByOrgAndStatus(organizationId, status); }

  async decide(organizationId: string, id: string, approve: boolean, deciderUserId: string) {
    const req = await this.requests.findByIdAndOrg(id, organizationId);
    if (!req || req.status !== 'PENDING') throw new NodeScopeException('ORG_012', 'JOIN_REQUEST_INVALID', HttpStatus.NOT_FOUND);
    if (approve) {
      if (await this.orgs.findMemberByUserId(req.userId)) throw new NodeScopeException('ORG_011', 'ALREADY_A_MEMBER', HttpStatus.CONFLICT);
      await this.orgs.createMember(req.userId, organizationId, 'MEMBER');
      this.realtime.emitEntityEvent(WS_EVENTS.ORG_MEMBER_ADDED, { userId: req.userId, role: 'MEMBER' }, organizationId);
    }
    await this.requests.decide(id, approve ? 'APPROVED' : 'DENIED', deciderUserId);
    this.realtime.emitEntityEvent(WS_EVENTS.ORG_JOIN_REQUEST_DECIDED, { id, approved: approve }, organizationId);
  }
}
```

- [ ] **Step 3: Run → PASS.**

- [ ] **Step 4: Controllers** — `join-request-submit.controller.ts` (`POST /v1/join-requests`, AuthGuard only) calls `submit(user.id, user.email)`; `join-requests.controller.ts` (`/v1/organizations/me/join-requests`, OWNER/ADMIN) exposes `GET ?status=` (default PENDING) and `POST :id/approve` / `POST :id/deny`.

- [ ] **Step 5: e2e** — user submits (domain match) → PENDING; admin approves → user becomes MEMBER; deny then re-submit succeeds.

- [ ] **Step 6: Commit** `feat(api): request-to-join (submit/list/approve/deny)`.

---

## Task 6: Member management (role change / removal)

**Files:** Modify `organizations.service.ts`; create `members.controller.ts`; test.

- [ ] **Step 1: Write the failing service test** — OWNER changes any role; ADMIN managing an ADMIN/OWNER → `ORG_003`; ADMIN setting role to ADMIN/OWNER → `ORG_003`; demote/remove the only OWNER → `ORG_013`; happy-path emits `ORG_MEMBER_UPDATED` / `ORG_MEMBER_REMOVED`.

- [ ] **Step 2: Implement the authority helper + service methods**

```typescript
// in organizations.service.ts
private assertCanManage(actorRole: OrgRole, targetCurrentRole: OrgRole, nextRole?: OrgRole) {
  if (actorRole === 'OWNER') return;
  if (actorRole === 'ADMIN') {
    const touchesPrivileged = targetCurrentRole !== 'MEMBER' || (nextRole && nextRole !== 'MEMBER');
    if (touchesPrivileged) throw new NodeScopeException('ORG_003', 'INSUFFICIENT_ORG_ROLE', HttpStatus.FORBIDDEN);
    return;
  }
  throw new NodeScopeException('ORG_003', 'INSUFFICIENT_ORG_ROLE', HttpStatus.FORBIDDEN);
}

async changeMemberRole(organizationId: string, actorRole: OrgRole, targetUserId: string, nextRole: OrgRole) {
  const target = await this.repo.findMemberByUserAndOrg(targetUserId, organizationId);
  if (!target) throw new NodeScopeException('ORG_002', 'NOT_AN_ORG_MEMBER', HttpStatus.NOT_FOUND);
  this.assertCanManage(actorRole, target.role, nextRole);
  if (target.role === 'OWNER' && nextRole !== 'OWNER' && (await this.repo.countOwners(organizationId)) <= 1) {
    throw new NodeScopeException('ORG_013', 'LAST_OWNER_PROTECTED', HttpStatus.CONFLICT);
  }
  await this.repo.updateMemberRole(targetUserId, organizationId, nextRole);
  this.realtime.emitEntityEvent(WS_EVENTS.ORG_MEMBER_UPDATED, { userId: targetUserId, role: nextRole }, organizationId);
}

async removeMember(organizationId: string, actorRole: OrgRole, targetUserId: string) {
  const target = await this.repo.findMemberByUserAndOrg(targetUserId, organizationId);
  if (!target) throw new NodeScopeException('ORG_002', 'NOT_AN_ORG_MEMBER', HttpStatus.NOT_FOUND);
  this.assertCanManage(actorRole, target.role);
  if (target.role === 'OWNER' && (await this.repo.countOwners(organizationId)) <= 1) {
    throw new NodeScopeException('ORG_013', 'LAST_OWNER_PROTECTED', HttpStatus.CONFLICT);
  }
  await this.repo.deleteMember(targetUserId, organizationId);
  this.realtime.emitEntityEvent(WS_EVENTS.ORG_MEMBER_REMOVED, { userId: targetUserId }, organizationId);
}
```

Inject `ConflictResolutionService` into `OrganizationsService` if not already present.

- [ ] **Step 3: Run → PASS.**

- [ ] **Step 4: Controller** (`members.controller.ts`, `/v1/organizations/me/members`, OWNER/ADMIN). The actor's role comes from `request.orgMember.role`; expose it via a small `@OrgRole()` param decorator (mirror `@OrgId()`, returning `request.orgMember.role`) or read `request.orgMember` directly.

```typescript
@Patch(':userId')
async changeRole(@OrgId() orgId: string, @OrgMemberRole() actorRole: OrgRole, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: ChangeMemberRoleDto) {
  await this.service.changeMemberRole(orgId, actorRole, userId, dto.role);
  return { success: true, data: null, timestamp: new Date().toISOString() };
}

@Delete(':userId')
async remove(@OrgId() orgId: string, @OrgMemberRole() actorRole: OrgRole, @Param('userId', ParseUUIDPipe) userId: string) {
  await this.service.removeMember(orgId, actorRole, userId);
  return { success: true, data: null, timestamp: new Date().toISOString() };
}
```

Create `decorators/org-member-role.decorator.ts` returning `request.orgMember.role` (throw `ORG_002` if null), mirroring `@OrgId()`.

- [ ] **Step 5: e2e** — OWNER promotes a MEMBER to ADMIN; ADMIN attempting to remove an OWNER → 403; removing the sole OWNER → 409 `ORG_013`.

- [ ] **Step 6: Commit** `feat(api): member role change + removal with authority model and last-owner protection`.

---

## Task 7: Wire module, full suite, docs

- [ ] **Step 1: Register** all new providers (`InvitationsRepository`, `InvitationsService`, `JoinRequestsRepository`, `JoinRequestsService`) and controllers (`InvitationsController`, `InvitationAcceptController`, `JoinRequestsController`, `JoinRequestSubmitController`, `MembersController`) in `OrganizationsModule`.
- [ ] **Step 2: Full suite.** `cd apps/api && npm run test:unit && npm run test:integration && npm run test:e2e` → all green.
- [ ] **Step 3: Docs (Rule 10).** Confirm `ORG_009`–`ORG_015` + the new WS events are in the API Design Document; note the invitation/join-request/member-management flows in the SAD.
- [ ] **Step 4: Commit** `feat(api): wire F1b membership module; docs + full suite green`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** invitations create/list/revoke/accept (§5) ✓ Task 4; request-to-join submit/list/approve/deny (§6) ✓ Task 5; member management + authority model + last-owner (§7) ✓ Task 6; models (§4) ✓ Task 1; DTOs/error codes/WS events (§8) ✓ Task 2; security (§9) — actor/email/org from session ✓ (accept uses `user.email`; submit uses `user.email` domain; org from session for admin actions).
- **Type consistency:** repo method names consistent across tasks; `emitEntityEvent(event, payload, organizationId)` used uniformly (matches Phase D); `assertCanManage(actorRole, targetCurrentRole, nextRole?)` used by both `changeMemberRole` and `removeMember`; `@OrgId()`/`@OrgMemberRole()` decorators consistent.
- **Ordering note:** `emitEntityEvent`'s third arg is the **org id**. If F1b is implemented before Phase D, that method still routes to a user room — pass the org id regardless and it becomes correct once Phase D lands (or do Phase D first). Flagged so the executor coordinates.
- **Integration points to verify:** `AuthenticatedUser.email` is present on the session; the `ConfigService` key for the app URL; whether `OrgContextGuard` is global (Phase B) to avoid double-listing it on controllers.
