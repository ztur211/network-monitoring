# F1a Phase A — Organization Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add organization tenancy as a purely additive layer — new models, a platform super-admin flag, an org module with guards and provisioning — without yet touching existing per-user entities, so the build stays green throughout.

**Architecture:** New `Organization`/`OrganizationDomain`/`OrganizationMember` Prisma models plus a `User.isSuperAdmin` flag. A new `organizations` NestJS module follows the existing controller→service→repository pattern. Org context is resolved from the authenticated session by an `OrgContextGuard` that attaches `request.orgMember`; a `SuperAdminGuard`, an `OrgRoleGuard`, and `@OrgId()`/`@OrgRoles()`/`@RequireSuperAdmin()` decorators mirror the existing `TierGuard`/`@RequireTier` pattern. A super-admin can provision an org, attach domains, and designate the first OWNER; members can read their org.

**Tech Stack:** NestJS, Prisma 5, PostgreSQL 16, Better Auth, Jest (integration tests against the test DB on `:5433`). Repository pattern, TDD test-first, `NodeScopeException(code, message, httpStatus)` for errors.

**Scope note:** This is Phase A of the F1a spec (`docs/superpowers/specs/2026-06-06-f1a-org-tenancy-design.md`). Phases B (re-scope existing entities), C (audit logging), D (realtime org rooms) follow as separate plans. Phase A deliberately does NOT add `organizationId` to `Device`/`Network`/etc.

---

## File Structure

**Create:**
- `apps/api/src/organizations/organizations.module.ts` — wires the org module
- `apps/api/src/organizations/organizations.repository.ts` — all Prisma access for org/domain/member
- `apps/api/src/organizations/organizations.service.ts` — org business logic
- `apps/api/src/organizations/organizations.controller.ts` — self-service org endpoints (`/v1/organizations/me`)
- `apps/api/src/organizations/admin-organizations.controller.ts` — super-admin provisioning (`/v1/admin/organizations`)
- `apps/api/src/organizations/organizations.dto.ts` — request DTOs (class-validator)
- `apps/api/src/organizations/org-context.types.ts` — `OrgMemberContext` shape + request augmentation
- `apps/api/src/organizations/guards/org-context.guard.ts` — loads membership → `request.orgMember`
- `apps/api/src/organizations/guards/super-admin.guard.ts` — checks `request.user.isSuperAdmin`
- `apps/api/src/organizations/guards/org-role.guard.ts` — checks `request.orgMember.role`
- `apps/api/src/organizations/decorators/org-id.decorator.ts` — `@OrgId()`
- `apps/api/src/organizations/decorators/org-roles.decorator.ts` — `@OrgRoles(...)`
- `apps/api/src/organizations/decorators/require-super-admin.decorator.ts` — `@RequireSuperAdmin()`
- `apps/api/src/organizations/__tests__/organizations.repository.spec.ts`
- `apps/api/src/organizations/__tests__/organizations.service.spec.ts`
- `apps/api/src/organizations/__tests__/org-context.guard.spec.ts`
- `apps/api/src/organizations/__tests__/admin-organizations.e2e-spec.ts`
- `apps/api/src/organizations/__tests__/organizations.e2e-spec.ts`

**Modify:**
- `apps/api/prisma/schema.prisma` — activate tenancy models, add `User.isSuperAdmin`, upgrade `ChangeLog` (columns only)
- `apps/api/src/auth/better-auth.config.ts` — add `isSuperAdmin` additionalField (`input: false`)
- `packages/shared/src/types/api.types.ts` — `OrganizationDto`, `OrganizationDomainDto`, `OrganizationMemberDto`
- `packages/shared/src/types/realtime.types.ts` — org WS event constants
- `apps/api/src/auth/auth.types.ts` (wherever `AuthenticatedUser` is defined) — add `isSuperAdmin: boolean`
- `apps/api/src/app.module.ts` — import `OrganizationsModule`

---

## Task 1: Schema — tenancy models, `isSuperAdmin`, `ChangeLog` upgrade

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create (generated): `apps/api/prisma/migrations/<timestamp>_f1a_org_tenancy_foundation/migration.sql`

- [ ] **Step 1: Add the `ChangeAction` enum and tenancy models to `schema.prisma`**

Add near the other enums:

```prisma
enum ChangeAction {
  CREATE
  UPDATE
  DELETE
}
```

Replace the commented-out `Organization`/`OrganizationMember` block at the bottom of the file with:

```prisma
model Organization {
  id            String   @id @default(uuid())
  name          String
  namingPattern String?
  namingMaxLen  Int?     @default(63)
  version       Int      @default(1)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  members    OrganizationMember[]
  domains    OrganizationDomain[]
  changeLogs ChangeLog[]
}

model OrganizationDomain {
  id             String   @id @default(uuid())
  organizationId String
  domain         String   @unique
  verified       Boolean  @default(false)
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
}

model OrganizationMember {
  id             String   @id @default(uuid())
  userId         String   @unique
  organizationId String
  role           OrgRole  @default(MEMBER)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
}
```

- [ ] **Step 2: Add `isSuperAdmin` + the `orgMember` relation to the `User` model**

In `model User`, add the field and uncomment/activate the relation:

```prisma
  isSuperAdmin Boolean @default(false)
  orgMember    OrganizationMember?
```

- [ ] **Step 3: Upgrade the `ChangeLog` model (columns only; writers come in Phase C)**

Replace the existing `ChangeLog` model with:

```prisma
model ChangeLog {
  id             String       @id @default(uuid())
  organizationId String
  userId         String?
  requestId      String
  action         ChangeAction
  entityType     String
  entityId       String
  field          String?
  oldValue       String?
  newValue       String?
  snapshot       Json?
  ipAddress      String?
  userAgent      String?
  comment        String?
  createdAt      DateTime     @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User?        @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([organizationId, entityType, entityId])
  @@index([organizationId, createdAt(sort: Desc)])
  @@index([requestId])
}
```

Note: the `User` model's existing `changeLogs ChangeLog[]` back-relation stays as-is (it remains valid with a nullable FK).

- [ ] **Step 4: Create the migration**

Run: `cd apps/api && npx prisma migrate dev --name f1a_org_tenancy_foundation`
Expected: a new migration directory is created and applies cleanly; `prisma generate` runs automatically. No errors. Existing entity tables are unchanged.

- [ ] **Step 5: Verify the client regenerated and compiles**

Run: `cd apps/api && npx tsc --noEmit`
Expected: PASS (no type errors — Phase A is additive, so existing code still compiles).

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): add organization tenancy models, isSuperAdmin, ChangeLog audit columns"
```

---

## Task 2: Better Auth — `isSuperAdmin` field (self-grant-proof)

**Files:**
- Modify: `apps/api/src/auth/better-auth.config.ts`
- Modify: `apps/api/src/auth/auth.types.ts` (the file declaring `AuthenticatedUser`)

- [ ] **Step 1: Add `isSuperAdmin` to `additionalFields` with `input: false`**

In `better-auth.config.ts`, alongside `tier`/`homeLatitude`/`homeLongitude`:

```typescript
isSuperAdmin: { type: 'boolean', defaultValue: false, input: false, returned: true },
```

- [ ] **Step 2: Add `isSuperAdmin` to the `AuthenticatedUser` type**

In `auth.types.ts`, add to the interface:

```typescript
isSuperAdmin: boolean;
```

- [ ] **Step 3: Verify compile**

Run: `cd apps/api && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/auth/better-auth.config.ts apps/api/src/auth/auth.types.ts
git commit -m "feat(api): expose isSuperAdmin on session (input:false, never client-settable)"
```

---

## Task 3: Shared DTO types + WS event constants

**Files:**
- Modify: `packages/shared/src/types/api.types.ts`
- Modify: `packages/shared/src/types/realtime.types.ts`

- [ ] **Step 1: Add org DTO interfaces (plain interfaces — no decorators in shared)**

Append to `api.types.ts`:

```typescript
export type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface OrganizationDto {
  id: string;
  name: string;
  namingPattern: string | null;
  namingMaxLen: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationDomainDto {
  id: string;
  domain: string;
  verified: boolean;
}

export interface OrganizationMemberDto {
  id: string;
  userId: string;
  organizationId: string;
  role: OrgRole;
  createdAt: string;
}
```

- [ ] **Step 2: Add org WS event constants**

In `realtime.types.ts`, add to the `WS_EVENTS` object:

```typescript
ORG_UPDATED: 'v1:org:updated',
ORG_MEMBER_ADDED: 'v1:org:member:added',
ORG_MEMBER_UPDATED: 'v1:org:member:updated',
ORG_MEMBER_REMOVED: 'v1:org:member:removed',
```

- [ ] **Step 3: Build the shared package**

Run: `cd packages/shared && npm run build`
Expected: PASS (clean type build).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/api.types.ts packages/shared/src/types/realtime.types.ts
git commit -m "feat(shared): add organization DTOs and org WS event constants"
```

---

## Task 4: `org-context.types.ts` — request augmentation

**Files:**
- Create: `apps/api/src/organizations/org-context.types.ts`

- [ ] **Step 1: Define `OrgMemberContext` and augment the Express request**

```typescript
import type { OrgRole } from '@prisma/client';

export interface OrgMemberContext {
  organizationId: string;
  role: OrgRole;
}

declare module 'express' {
  interface Request {
    orgMember?: OrgMemberContext | null;
  }
}
```

- [ ] **Step 2: Verify compile**

Run: `cd apps/api && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/organizations/org-context.types.ts
git commit -m "feat(api): add OrgMemberContext request augmentation"
```

---

## Task 5: `OrganizationsRepository` (+ integration tests)

**Files:**
- Create: `apps/api/src/organizations/organizations.repository.ts`
- Test: `apps/api/src/organizations/__tests__/organizations.repository.spec.ts`

- [ ] **Step 1: Write the failing integration test**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationsRepository } from '../organizations.repository';

describe('OrganizationsRepository (integration)', () => {
  let repo: OrganizationsRepository;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [OrganizationsRepository, PrismaService],
    }).compile();
    repo = moduleRef.get(OrganizationsRepository);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates an org, adds a domain, and finds the org by domain', async () => {
    const org = await repo.createOrganization({ name: `Acme ${Date.now()}` });
    const domain = `acme-${Date.now()}.com`;
    await repo.addDomain(org.id, domain);

    const found = await repo.findOrganizationByDomain(domain);
    expect(found?.organization.id).toBe(org.id);

    await prisma.organization.delete({ where: { id: org.id } });
  });

  it('creates a member and finds it by userId (one org per user)', async () => {
    const user = await prisma.user.create({
      data: { email: `m-${Date.now()}@x.com`, emailVerified: false, name: 'M' },
    });
    const org = await repo.createOrganization({ name: `Org ${Date.now()}` });
    await repo.createMember(user.id, org.id, 'OWNER');

    const member = await repo.findMemberByUserId(user.id);
    expect(member?.organizationId).toBe(org.id);
    expect(member?.role).toBe('OWNER');

    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npm run test:integration -- organizations.repository`
Expected: FAIL — `Cannot find module '../organizations.repository'`.

- [ ] **Step 3: Implement the repository**

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma, Organization, OrganizationDomain, OrganizationMember, OrgRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrganizationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createOrganization(data: { name: string }): Promise<Organization> {
    return this.prisma.organization.create({ data });
  }

  findOrganizationById(id: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { id } });
  }

  async updateOrganizationWithVersion(
    id: string,
    data: Prisma.OrganizationUpdateInput,
    expectedVersion: number,
  ): Promise<Organization | null> {
    const result = await this.prisma.organization.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return this.prisma.organization.findUnique({ where: { id } });
  }

  addDomain(organizationId: string, domain: string): Promise<OrganizationDomain> {
    return this.prisma.organizationDomain.create({ data: { organizationId, domain } });
  }

  findOrganizationByDomain(
    domain: string,
  ): Promise<(OrganizationDomain & { organization: Organization }) | null> {
    return this.prisma.organizationDomain.findUnique({
      where: { domain },
      include: { organization: true },
    });
  }

  createMember(userId: string, organizationId: string, role: OrgRole): Promise<OrganizationMember> {
    return this.prisma.organizationMember.create({ data: { userId, organizationId, role } });
  }

  findMemberByUserId(userId: string): Promise<OrganizationMember | null> {
    return this.prisma.organizationMember.findUnique({ where: { userId } });
  }

  findMembersByOrganizationId(organizationId: string): Promise<OrganizationMember[]> {
    return this.prisma.organizationMember.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && npm run test:integration -- organizations.repository`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/organizations/organizations.repository.ts apps/api/src/organizations/__tests__/organizations.repository.spec.ts
git commit -m "feat(api): add OrganizationsRepository with integration tests"
```

---

## Task 6: `OrganizationsService` (+ unit tests)

**Files:**
- Create: `apps/api/src/organizations/organizations.service.ts`
- Create: `apps/api/src/organizations/organizations.dto.ts`
- Test: `apps/api/src/organizations/__tests__/organizations.service.spec.ts`

Assumes `UsersRepository` exists at `apps/api/src/users/users.repository.ts` with `findByEmail(email: string): Promise<User | null>` (confirmed present). If the method name differs, use the existing equivalent.

- [ ] **Step 1: Write the request DTOs**

```typescript
import { IsString, MinLength, MaxLength, IsEmail, IsEnum, IsOptional, IsInt, Min, IsArray, ArrayMinSize, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { OrgRole } from '@prisma/client';
import { ChangesetChangeDto } from '../common/changeset.dto'; // existing changeset change DTO

export class CreateOrganizationDto {
  @IsString() @MinLength(1) @MaxLength(120)
  name: string;
}

export class AddDomainDto {
  @IsString() @MinLength(3) @MaxLength(253)
  domain: string;
}

export class DesignateOwnerDto {
  @IsEmail()
  email: string;
}

export const ORG_WRITABLE_FIELDS = ['name', 'namingPattern', 'namingMaxLen'] as const;

export class PatchOrganizationDto {
  @IsInt() @Min(1)
  baseVersion: number;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10)
  @ValidateNested({ each: true }) @Type(() => ChangesetChangeDto)
  changes: ChangesetChangeDto[];
}
```

If `apps/api/src/common/changeset.dto.ts` does not exist, reuse the existing `ChangesetChangeDto` from the devices module (`apps/api/src/devices/devices.dto.ts`) by importing it from there instead.

- [ ] **Step 2: Write the failing service test**

```typescript
import { Test } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { OrganizationsService } from '../organizations.service';
import { OrganizationsRepository } from '../organizations.repository';
import { UsersRepository } from '../../users/users.repository';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

const repoMock = () => ({
  createOrganization: jest.fn(),
  findOrganizationById: jest.fn(),
  addDomain: jest.fn(),
  findOrganizationByDomain: jest.fn(),
  createMember: jest.fn(),
  findMemberByUserId: jest.fn(),
  findMembersByOrganizationId: jest.fn(),
  updateOrganizationWithVersion: jest.fn(),
});
const usersMock = () => ({ findByEmail: jest.fn() });

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let repo: ReturnType<typeof repoMock>;
  let users: ReturnType<typeof usersMock>;

  beforeEach(async () => {
    repo = repoMock();
    users = usersMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: OrganizationsRepository, useValue: repo },
        { provide: UsersRepository, useValue: users },
      ],
    }).compile();
    service = moduleRef.get(OrganizationsService);
  });

  it('rejects a domain already claimed by another org (ORG_004)', async () => {
    repo.findOrganizationByDomain.mockResolvedValue({ organization: { id: 'other' } });
    await expect(service.addDomain('org1', 'taken.com')).rejects.toMatchObject({ code: 'ORG_004' });
  });

  it('rejects designating an owner who already belongs to an org', async () => {
    users.findByEmail.mockResolvedValue({ id: 'u1' });
    repo.findMemberByUserId.mockResolvedValue({ organizationId: 'someOrg' });
    await expect(service.designateOwner('org1', 'u@x.com')).rejects.toBeInstanceOf(NodeScopeException);
  });

  it('throws ORG_002 when a user has no membership', async () => {
    repo.findMemberByUserId.mockResolvedValue(null);
    await expect(service.getMyOrganization('u1')).rejects.toMatchObject({ code: 'ORG_002' });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/api && npm run test:unit -- organizations.service`
Expected: FAIL — `Cannot find module '../organizations.service'`.

- [ ] **Step 4: Implement the service**

```typescript
import { HttpStatus, Injectable } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { OrganizationDto, OrganizationMemberDto } from '@nodescope/shared';
import { OrganizationsRepository } from './organizations.repository';
import { UsersRepository } from '../users/users.repository';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict-resolution.service';
import { CreateOrganizationDto, PatchOrganizationDto, ORG_WRITABLE_FIELDS } from './organizations.dto';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly repo: OrganizationsRepository,
    private readonly users: UsersRepository,
    private readonly conflict: ConflictResolutionService,
  ) {}

  async provisionOrganization(dto: CreateOrganizationDto): Promise<OrganizationDto> {
    const org = await this.repo.createOrganization({ name: dto.name });
    return this.toDto(org);
  }

  async addDomain(organizationId: string, domain: string): Promise<void> {
    const normalized = domain.trim().toLowerCase();
    const existing = await this.repo.findOrganizationByDomain(normalized);
    if (existing) {
      throw new NodeScopeException('ORG_004', 'DOMAIN_ALREADY_CLAIMED', HttpStatus.CONFLICT);
    }
    const org = await this.repo.findOrganizationById(organizationId);
    if (!org) throw new NodeScopeException('ORG_001', 'ORGANIZATION_NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.repo.addDomain(organizationId, normalized);
  }

  async designateOwner(organizationId: string, email: string): Promise<OrganizationMemberDto> {
    const org = await this.repo.findOrganizationById(organizationId);
    if (!org) throw new NodeScopeException('ORG_001', 'ORGANIZATION_NOT_FOUND', HttpStatus.NOT_FOUND);
    const user = await this.users.findByEmail(email);
    if (!user) throw new NodeScopeException('ORG_001', 'USER_NOT_FOUND', HttpStatus.NOT_FOUND);
    const existing = await this.repo.findMemberByUserId(user.id);
    if (existing) {
      throw new NodeScopeException('ORG_003', 'USER_ALREADY_IN_ORG', HttpStatus.CONFLICT);
    }
    const member = await this.repo.createMember(user.id, organizationId, OrgRole.OWNER);
    return this.toMemberDto(member);
  }

  async getMyOrganization(userId: string): Promise<OrganizationDto> {
    const member = await this.repo.findMemberByUserId(userId);
    if (!member) throw new NodeScopeException('ORG_002', 'NOT_AN_ORG_MEMBER', HttpStatus.FORBIDDEN);
    const org = await this.repo.findOrganizationById(member.organizationId);
    if (!org) throw new NodeScopeException('ORG_001', 'ORGANIZATION_NOT_FOUND', HttpStatus.NOT_FOUND);
    return this.toDto(org);
  }

  async getMyMembers(organizationId: string): Promise<OrganizationMemberDto[]> {
    const members = await this.repo.findMembersByOrganizationId(organizationId);
    return members.map((m) => this.toMemberDto(m));
  }

  async updateMyOrganization(organizationId: string, patch: PatchOrganizationDto): Promise<OrganizationDto> {
    const org = await this.repo.findOrganizationById(organizationId);
    if (!org) throw new NodeScopeException('ORG_001', 'ORGANIZATION_NOT_FOUND', HttpStatus.NOT_FOUND);
    const updatePayload = this.conflict.buildUpdatePayload(
      patch,
      ORG_WRITABLE_FIELDS,
      org.version,
      CreateOrganizationDto,
    );
    const updated = await this.repo.updateOrganizationWithVersion(organizationId, updatePayload, patch.baseVersion);
    if (!updated) throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);
    return this.toDto(updated);
  }

  private toDto(o: { id: string; name: string; namingPattern: string | null; namingMaxLen: number | null; version: number; createdAt: Date; updatedAt: Date }): OrganizationDto {
    return {
      id: o.id, name: o.name, namingPattern: o.namingPattern, namingMaxLen: o.namingMaxLen,
      version: o.version, createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString(),
    };
  }

  private toMemberDto(m: { id: string; userId: string; organizationId: string; role: OrgRole; createdAt: Date }): OrganizationMemberDto {
    return { id: m.id, userId: m.userId, organizationId: m.organizationId, role: m.role, createdAt: m.createdAt.toISOString() };
  }
}
```

Note: `@nodescope/shared` is the workspace import alias — confirm the exact alias in an existing service's imports (e.g. `devices.service.ts`) and match it.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/api && npm run test:unit -- organizations.service`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/organizations/organizations.service.ts apps/api/src/organizations/organizations.dto.ts apps/api/src/organizations/__tests__/organizations.service.spec.ts
git commit -m "feat(api): add OrganizationsService with provisioning, domain, owner, and read logic"
```

---

## Task 7: `OrgContextGuard` + `@OrgId()` + `@OrgRoles()` (+ unit test)

**Files:**
- Create: `apps/api/src/organizations/guards/org-context.guard.ts`
- Create: `apps/api/src/organizations/guards/org-role.guard.ts`
- Create: `apps/api/src/organizations/decorators/org-id.decorator.ts`
- Create: `apps/api/src/organizations/decorators/org-roles.decorator.ts`
- Test: `apps/api/src/organizations/__tests__/org-context.guard.spec.ts`

- [ ] **Step 1: Write the failing guard test**

```typescript
import { ExecutionContext } from '@nestjs/common';
import { OrgContextGuard } from '../guards/org-context.guard';
import { OrganizationsRepository } from '../organizations.repository';

function ctxFor(request: any): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
}

describe('OrgContextGuard', () => {
  it('attaches request.orgMember from the session user membership', async () => {
    const repo = { findMemberByUserId: jest.fn().mockResolvedValue({ organizationId: 'org1', role: 'ADMIN' }) };
    const guard = new OrgContextGuard(repo as unknown as OrganizationsRepository);
    const request: any = { user: { id: 'u1' } };
    await guard.canActivate(ctxFor(request));
    expect(request.orgMember).toEqual({ organizationId: 'org1', role: 'ADMIN' });
  });

  it('attaches null when the user has no membership (does not throw)', async () => {
    const repo = { findMemberByUserId: jest.fn().mockResolvedValue(null) };
    const guard = new OrgContextGuard(repo as unknown as OrganizationsRepository);
    const request: any = { user: { id: 'u1' } };
    const result = await guard.canActivate(ctxFor(request));
    expect(result).toBe(true);
    expect(request.orgMember).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npm run test:unit -- org-context.guard`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the guard and decorators**

`guards/org-context.guard.ts`:

```typescript
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { OrganizationsRepository } from '../organizations.repository';

@Injectable()
export class OrgContextGuard implements CanActivate {
  constructor(private readonly repo: OrganizationsRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.id;
    if (!userId) {
      request.orgMember = null;
      return true;
    }
    const member = await this.repo.findMemberByUserId(userId);
    request.orgMember = member ? { organizationId: member.organizationId, role: member.role } : null;
    return true;
  }
}
```

`decorators/org-id.decorator.ts`:

```typescript
import { createParamDecorator, ExecutionContext, HttpStatus } from '@nestjs/common';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

export const OrgId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  if (!request.orgMember) {
    throw new NodeScopeException('ORG_002', 'NOT_AN_ORG_MEMBER', HttpStatus.FORBIDDEN);
  }
  return request.orgMember.organizationId;
});
```

`decorators/org-roles.decorator.ts`:

```typescript
import { SetMetadata } from '@nestjs/common';
import { OrgRole } from '@prisma/client';

export const ORG_ROLES_KEY = 'orgRoles';
export const OrgRoles = (...roles: OrgRole[]) => SetMetadata(ORG_ROLES_KEY, roles);
```

`guards/org-role.guard.ts`:

```typescript
import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { ORG_ROLES_KEY } from '../decorators/org-roles.decorator';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

@Injectable()
export class OrgRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<OrgRole[]>(ORG_ROLES_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const request = context.switchToHttp().getRequest();
    if (!request.orgMember) {
      throw new NodeScopeException('ORG_002', 'NOT_AN_ORG_MEMBER', HttpStatus.FORBIDDEN);
    }
    if (!required.includes(request.orgMember.role)) {
      throw new NodeScopeException('ORG_003', 'INSUFFICIENT_ORG_ROLE', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && npm run test:unit -- org-context.guard`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/organizations/guards/org-context.guard.ts apps/api/src/organizations/guards/org-role.guard.ts apps/api/src/organizations/decorators/org-id.decorator.ts apps/api/src/organizations/decorators/org-roles.decorator.ts apps/api/src/organizations/__tests__/org-context.guard.spec.ts
git commit -m "feat(api): add OrgContextGuard, OrgRoleGuard, @OrgId and @OrgRoles"
```

---

## Task 8: `SuperAdminGuard` + `@RequireSuperAdmin()` (+ unit test)

**Files:**
- Create: `apps/api/src/organizations/guards/super-admin.guard.ts`
- Create: `apps/api/src/organizations/decorators/require-super-admin.decorator.ts`
- Test: add a `describe` block to `apps/api/src/organizations/__tests__/org-context.guard.spec.ts` (or a new `super-admin.guard.spec.ts`)

- [ ] **Step 1: Write the failing test** (`super-admin.guard.spec.ts`)

```typescript
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { SuperAdminGuard } from '../guards/super-admin.guard';

function ctxFor(request: any): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
}

describe('SuperAdminGuard', () => {
  const guard = new SuperAdminGuard();

  it('allows a super-admin', () => {
    expect(guard.canActivate(ctxFor({ user: { isSuperAdmin: true } }))).toBe(true);
  });

  it('rejects a non-super-admin with ORG_007', () => {
    expect(() => guard.canActivate(ctxFor({ user: { isSuperAdmin: false } }))).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npm run test:unit -- super-admin.guard`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the guard and decorator**

`guards/super-admin.guard.ts`:

```typescript
import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (!request.user?.isSuperAdmin) {
      throw new NodeScopeException('ORG_007', 'SUPERADMIN_REQUIRED', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}
```

`decorators/require-super-admin.decorator.ts`:

```typescript
import { applyDecorators, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '../guards/super-admin.guard';

export const RequireSuperAdmin = () => applyDecorators(UseGuards(SuperAdminGuard));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && npm run test:unit -- super-admin.guard`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/organizations/guards/super-admin.guard.ts apps/api/src/organizations/decorators/require-super-admin.decorator.ts apps/api/src/organizations/__tests__/super-admin.guard.spec.ts
git commit -m "feat(api): add SuperAdminGuard and @RequireSuperAdmin"
```

---

## Task 9: Admin provisioning controller + module wiring (+ e2e)

**Files:**
- Create: `apps/api/src/organizations/admin-organizations.controller.ts`
- Create: `apps/api/src/organizations/organizations.controller.ts`
- Create: `apps/api/src/organizations/organizations.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/organizations/__tests__/admin-organizations.e2e-spec.ts`

- [ ] **Step 1: Implement the admin controller**

```typescript
import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RequireSuperAdmin } from './decorators/require-super-admin.decorator';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto, AddDomainDto, DesignateOwnerDto } from './organizations.dto';

@Controller('v1/admin/organizations')
@UseGuards(AuthGuard)
@RequireSuperAdmin()
export class AdminOrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  @Post()
  async create(@Body() dto: CreateOrganizationDto) {
    return { success: true, data: await this.service.provisionOrganization(dto), timestamp: new Date().toISOString() };
  }

  @Post(':id/domains')
  async addDomain(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddDomainDto) {
    await this.service.addDomain(id, dto.domain);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }

  @Post(':id/owner')
  async designateOwner(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DesignateOwnerDto) {
    return { success: true, data: await this.service.designateOwner(id, dto.email), timestamp: new Date().toISOString() };
  }
}
```

- [ ] **Step 2: Implement the self-service controller**

```typescript
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { OrgContextGuard } from './guards/org-context.guard';
import { OrgRoleGuard } from './guards/org-role.guard';
import { OrgRoles } from './decorators/org-roles.decorator';
import { OrgId } from './decorators/org-id.decorator';
import { OrganizationsService } from './organizations.service';
import { PatchOrganizationDto } from './organizations.dto';

@Controller('v1/organizations')
@UseGuards(AuthGuard, OrgContextGuard, OrgRoleGuard)
export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  @Get('me')
  async myOrg(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.service.getMyOrganization(user.id), timestamp: new Date().toISOString() };
  }

  @Get('me/members')
  async myMembers(@OrgId() orgId: string) {
    return { success: true, data: await this.service.getMyMembers(orgId), timestamp: new Date().toISOString() };
  }

  @Patch('me')
  @OrgRoles('OWNER', 'ADMIN')
  async updateMyOrg(@OrgId() orgId: string, @Body() patch: PatchOrganizationDto) {
    return { success: true, data: await this.service.updateMyOrganization(orgId, patch), timestamp: new Date().toISOString() };
  }
}
```

- [ ] **Step 3: Implement the module**

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { ConflictModule } from '../conflict/conflict.module';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { AdminOrganizationsController } from './admin-organizations.controller';

@Module({
  imports: [PrismaModule, UsersModule, ConflictModule],
  controllers: [OrganizationsController, AdminOrganizationsController],
  providers: [OrganizationsRepository, OrganizationsService],
  exports: [OrganizationsRepository],
})
export class OrganizationsModule {}
```

Confirm the exact names of `UsersModule`/`ConflictModule` and that `UsersModule` exports `UsersRepository` and `ConflictModule` exports `ConflictResolutionService`; adjust imports to match existing module exports.

- [ ] **Step 4: Register the module in `app.module.ts`**

Add `OrganizationsModule` to the `imports` array of `AppModule`.

- [ ] **Step 5: Write the failing e2e test**

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

// Mirror the auth-mocking approach used by other e2e specs in this repo
// (e.g. how devices.e2e overrides AuthGuard to inject a test user).
describe('Admin organizations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // .overrideGuard(AuthGuard).useValue({ canActivate: (ctx) => { ctx.switchToHttp().getRequest().user = { id: SUPER_ADMIN_ID, isSuperAdmin: true }; return true; } })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => { await app.close(); });

  it('super-admin creates an org and designates an owner', async () => {
    const create = await request(app.getHttpServer())
      .post('/v1/admin/organizations')
      .send({ name: `E2E Org ${Date.now()}` })
      .expect(201);
    const orgId = create.body.data.id;

    const user = await prisma.user.create({
      data: { email: `owner-${Date.now()}@x.com`, emailVerified: true, name: 'Owner' },
    });
    await request(app.getHttpServer())
      .post(`/v1/admin/organizations/${orgId}/owner`)
      .send({ email: user.email })
      .expect(201);

    const member = await prisma.organizationMember.findUnique({ where: { userId: user.id } });
    expect(member?.role).toBe('OWNER');

    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: orgId } });
  });
});
```

Before writing the implementation: open an existing e2e spec (e.g. `apps/api/src/devices/__tests__/*.e2e-spec.ts`) and copy its exact AuthGuard-override / test-user-injection mechanism into the `beforeAll` above, replacing the commented placeholder. Do not invent an auth-mocking approach.

- [ ] **Step 6: Run the e2e test to verify it fails, then passes**

Run: `cd apps/api && npm run test:e2e -- admin-organizations`
Expected: first FAIL (controllers/module not wired), then PASS after Steps 1–4 are in place.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/organizations/admin-organizations.controller.ts apps/api/src/organizations/organizations.controller.ts apps/api/src/organizations/organizations.module.ts apps/api/src/app.module.ts apps/api/src/organizations/__tests__/admin-organizations.e2e-spec.ts
git commit -m "feat(api): add org provisioning + self-service controllers and wire OrganizationsModule"
```

---

## Task 10: Org self-service e2e + documentation

**Files:**
- Test: `apps/api/src/organizations/__tests__/organizations.e2e-spec.ts`
- Modify: the API Design Document (register error codes) and the F1a spec status

- [ ] **Step 1: Write the org self-service e2e test**

Use a mutable `currentUser` that the overridden `AuthGuard` injects, so each test can act as a different role. Mirror the *exact* override mechanism from an existing e2e spec (see Task 9 — if `AuthGuard` is a global `APP_GUARD`, override it the way the existing specs do rather than `.overrideGuard`).

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

describe('Organizations self-service (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let currentUser: { id: string; isSuperAdmin: boolean };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = currentUser;
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => { await app.close(); });

  it('member reads org and roster; MEMBER cannot patch; OWNER can', async () => {
    const org = await prisma.organization.create({ data: { name: `E2E ${Date.now()}` } });
    const owner = await prisma.user.create({ data: { email: `o-${Date.now()}@x.com`, emailVerified: true, name: 'O' } });
    const member = await prisma.user.create({ data: { email: `m-${Date.now()}@x.com`, emailVerified: true, name: 'M' } });
    await prisma.organizationMember.create({ data: { userId: owner.id, organizationId: org.id, role: 'OWNER' } });
    await prisma.organizationMember.create({ data: { userId: member.id, organizationId: org.id, role: 'MEMBER' } });

    currentUser = { id: member.id, isSuperAdmin: false };
    const me = await request(app.getHttpServer()).get('/v1/organizations/me').expect(200);
    expect(me.body.data.id).toBe(org.id);

    const roster = await request(app.getHttpServer()).get('/v1/organizations/me/members').expect(200);
    expect(roster.body.data).toHaveLength(2);

    const denied = await request(app.getHttpServer())
      .patch('/v1/organizations/me')
      .send({ baseVersion: 1, changes: [{ field: 'namingPattern', oldValue: null, newValue: '^[a-z]+-[0-9]+$' }] })
      .expect(403);
    expect(denied.body.code).toBe('ORG_003');

    currentUser = { id: owner.id, isSuperAdmin: false };
    const ok = await request(app.getHttpServer())
      .patch('/v1/organizations/me')
      .send({ baseVersion: 1, changes: [{ field: 'namingPattern', oldValue: null, newValue: '^[a-z]+-[0-9]+$' }] })
      .expect(200);
    expect(ok.body.data.version).toBe(2);
    expect(ok.body.data.namingPattern).toBe('^[a-z]+-[0-9]+$');

    await prisma.organizationMember.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, member.id] } } });
    await prisma.organization.delete({ where: { id: org.id } });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd apps/api && npm run test:e2e -- organizations.e2e`
Expected: PASS.

- [ ] **Step 3: Register the ORG error codes in the API Design Document**

Locate the API Design Document (search: `grep -rl "DEVICE_001" docs/`). Add the `ORG_001`–`ORG_008` codes with their messages and HTTP statuses, matching the existing table format. If no such doc file exists in the repo, record them in the F1a spec's §10.3 (already listed) and note the canonical location for Phase B/C to extend.

- [ ] **Step 4: Run the full backend test suite**

Run: `cd apps/api && npm run test:unit && npm run test:integration && npm run test:e2e`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/organizations/__tests__/organizations.e2e-spec.ts docs/
git commit -m "test(api): org self-service e2e; docs: register ORG_* error codes"
```

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage (Phase A subset of F1a §):** tenancy models (§4.1) ✓ Task 1; `isSuperAdmin` (§4.2) ✓ Tasks 1–2; super-admin provisioning (§7) ✓ Tasks 6, 9; session-derived org + guards (§8) ✓ Tasks 7–8; org endpoints (§10.6) ✓ Tasks 9–10; DTOs/WS events/error codes (§10) ✓ Tasks 3, 10. Deferred to later phases (correctly out of Phase A): re-scoping existing entities (§4.3–4.5) → Phase B; naming-policy enforcement on devices (§6) → Phase B; audit writers (§5) → Phase C; org realtime rooms (§8) → Phase D.
- **Type consistency:** `OrgMemberContext { organizationId, role }` defined in Task 4, used identically in Tasks 7, 9. `findMemberByUserId` signature consistent across Tasks 5, 7. `NodeScopeException(code, message, httpStatus)` used uniformly. `ORG_ROLES_KEY`/`@OrgRoles`/`OrgRoleGuard` names align.
- **Known integration points to verify during execution (flagged in-task, not placeholders):** the `@nodescope/shared` import alias (Task 6), the exact `ChangesetChangeDto` location (Task 6), the e2e AuthGuard-override mechanism (Tasks 9–10), and the names/exports of `UsersModule`/`ConflictModule` (Task 9). Each task says to confirm against the named existing file.
