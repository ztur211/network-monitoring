# F2 Phase A — Property Tree Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the org-owned, typed, self-referencing `Property` site tree (`SITE`/`BUILDING`/`FLOOR`/`AREA`) with full CRUD, server-enforced nesting rules, case-insensitive sibling-name uniqueness, cycle-safe reparenting, delete-blocking, and subtree helpers — purely additively, so the build stays green.

**Architecture:** A new `properties` NestJS module follows the existing controller→service→repository pattern. Nesting rules live in a pure, unit-tested helper. Subtree/ancestor queries use Postgres `WITH RECURSIVE` CTEs via `$queryRaw`. Mutations are OWNER/ADMIN-gated (`@OrgRoles`); reads are open to any member. Org scoping, audit (`ChangeLog`), realtime org-room events, and optimistic concurrency all reuse F1a's machinery.

**Tech Stack:** NestJS, Prisma 5, PostgreSQL 16, Jest (test DB on `:5433`). Repository pattern, TDD, `NodeScopeException`, optimistic concurrency via `updateMany` + `version`.

**Depends on:** F1a fully implemented — `OrganizationsModule` (`OrganizationsRepository`, `OrgContextGuard` global, `OrgRoleGuard`, `@OrgId()`, `@OrgRoles()`), `NodeScopeException`, `ConflictResolutionService` (`buildUpdatePayload`, `emitEntityEvent(event, payload, organizationId)`), `AuditService` (`recordCreate/recordUpdate/recordDelete`), `ChangesetChangeDto`, the `{ success, data, timestamp }` envelope, `PrismaService`. Spec: `docs/superpowers/specs/2026-06-08-f2-sites-node-grouping-design.md` (§4.1, §5, §10).

> This phase is additive — it does **not** touch `Device`/`Network`. Device placement, charters, and containment are **Phase B**; the delete-block here checks **children only** (Phase B extends it to devices/charters), and reparent re-validation for containment is **Phase B**.

---

## File Structure

**Create:**
- `apps/api/src/properties/property-nesting.ts` — pure nesting-rule helper (`ALLOWED_CHILDREN`, `assertValidNesting`)
- `apps/api/src/properties/properties.repository.ts` — all Prisma access incl. recursive subtree/ancestor queries
- `apps/api/src/properties/properties.service.ts` — business logic (CRUD, nesting, cycle, delete-block, subtree helpers)
- `apps/api/src/properties/properties.controller.ts` — `/v1/properties`
- `apps/api/src/properties/properties.dto.ts` — request DTOs
- `apps/api/src/properties/properties.module.ts`
- `apps/api/src/properties/__tests__/property-nesting.spec.ts`
- `apps/api/src/properties/__tests__/properties.repository.spec.ts`
- `apps/api/src/properties/__tests__/properties.service.spec.ts`
- `apps/api/src/properties/__tests__/properties.e2e-spec.ts`

**Modify:**
- `apps/api/prisma/schema.prisma` — add `PropertyType`, `Property`, `Organization.properties` back-relation
- `packages/shared/src/types/api.types.ts` — `PropertyType`, `PropertyDto`
- `packages/shared/src/types/realtime.types.ts` — `v1:property:*` events
- `apps/api/src/app.module.ts` — import `PropertiesModule`

---

## Task 1: Schema — `Property` + `PropertyType` + functional unique indexes

**Files:** Modify `apps/api/prisma/schema.prisma`; generated migration.

- [ ] **Step 1: Add the enum and model** (from spec §4.1)

```prisma
enum PropertyType { SITE BUILDING FLOOR AREA }

model Property {
  id             String       @id @default(uuid())
  organizationId String
  parentId       String?
  type           PropertyType
  name           String
  code           String?
  version        Int          @default(1)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  parent       Property?    @relation("PropertyTree", fields: [parentId], references: [id], onDelete: Restrict)
  children     Property[]   @relation("PropertyTree")

  @@index([organizationId])
  @@index([organizationId, parentId])
  @@index([organizationId, type])
}
```

Add `properties Property[]` to `model Organization`.

- [ ] **Step 2: Create the migration.** `cd apps/api && npx prisma migrate dev --name f2_property_tree` → created and applied; client regenerates.

- [ ] **Step 3: Append the case-insensitive sibling-unique indexes (raw SQL).** Edit the generated `migration.sql`, appending (Postgres treats NULLs as distinct, so roots need a separate partial index):

```sql
CREATE UNIQUE INDEX "property_parent_name_lower_uniq"
  ON "Property" ("organizationId", "parentId", lower("name")) WHERE "parentId" IS NOT NULL;
CREATE UNIQUE INDEX "property_root_name_lower_uniq"
  ON "Property" ("organizationId", lower("name")) WHERE "parentId" IS NULL;
```

Re-apply: `cd apps/api && npx prisma migrate reset --force` (greenfield).

- [ ] **Step 4: `npx tsc --noEmit`** → PASS.

- [ ] **Step 5: Commit** `feat(api): add Property model and PropertyType for the site tree`.

---

## Task 2: Shared DTOs + WS events + error-code registration

**Files:** Modify `packages/shared/src/types/api.types.ts`, `realtime.types.ts`; API Design Document.

- [ ] **Step 1: Add to `api.types.ts`**

```typescript
export type PropertyType = 'SITE' | 'BUILDING' | 'FLOOR' | 'AREA';

export interface PropertyDto {
  id: string;
  organizationId: string;
  parentId: string | null;
  type: PropertyType;
  name: string;
  code: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Add WS event constants to `realtime.types.ts`** (in the `WS_EVENTS` object)

```typescript
PROPERTY_CREATED: 'v1:property:created',
PROPERTY_UPDATED: 'v1:property:updated',
PROPERTY_DELETED: 'v1:property:deleted',
PROPERTY_MOVED:   'v1:property:moved',
```

- [ ] **Step 3: Build shared.** `cd packages/shared && npm run build` → PASS.

- [ ] **Step 4: Register `PROP_001`–`PROP_005`** in the API Design Document (spec §10.3), matching the existing table format: `PROP_001 PROPERTY_NOT_FOUND` (404), `PROP_002 INVALID_PARENT_TYPE` (422), `PROP_003 PROPERTY_NAME_TAKEN` (409), `PROP_004 PROPERTY_NOT_EMPTY` (409), `PROP_005 PROPERTY_CYCLE` (422).

- [ ] **Step 5: Commit** `feat(shared): add PropertyDto + property WS events; docs: register PROP_001-005`.

---

## Task 3: Nesting-rule helper (pure function, TDD)

**Files:** Create `property-nesting.ts`; test `__tests__/property-nesting.spec.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
import { assertValidNesting, ALLOWED_CHILDREN } from '../property-nesting';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

describe('assertValidNesting', () => {
  it('allows SITE as a root (no parent)', () => {
    expect(() => assertValidNesting(null, 'SITE')).not.toThrow();
  });
  it('rejects a non-SITE root with PROP_002', () => {
    expect(() => assertValidNesting(null, 'BUILDING')).toThrow(NodeScopeException);
  });
  it('allows BUILDING under SITE and AREA under FLOOR', () => {
    expect(() => assertValidNesting('SITE', 'BUILDING')).not.toThrow();
    expect(() => assertValidNesting('FLOOR', 'AREA')).not.toThrow();
  });
  it('rejects FLOOR under SITE (PROP_002)', () => {
    expect(() => assertValidNesting('SITE', 'FLOOR')).toThrow(NodeScopeException);
  });
  it('allows SITE under SITE (sub-sites) and AREA under AREA', () => {
    expect(() => assertValidNesting('SITE', 'SITE')).not.toThrow();
    expect(() => assertValidNesting('AREA', 'AREA')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:unit -- property-nesting` → module not found.

- [ ] **Step 3: Implement `property-nesting.ts`**

```typescript
import { HttpStatus } from '@nestjs/common';
import { PropertyType } from '@prisma/client';
import { NodeScopeException } from '../common/filters/global-exception.filter';

// Parent type → the child types it may contain (spec §5).
export const ALLOWED_CHILDREN: Record<PropertyType, PropertyType[]> = {
  SITE: ['SITE', 'BUILDING', 'AREA'],
  BUILDING: ['FLOOR', 'AREA'],
  FLOOR: ['AREA'],
  AREA: ['AREA'],
};

/** Throws PROP_002 if `childType` may not sit under `parentType` (null parent = root, must be SITE). */
export function assertValidNesting(parentType: PropertyType | null, childType: PropertyType): void {
  if (parentType === null) {
    if (childType !== 'SITE') {
      throw new NodeScopeException('PROP_002', 'INVALID_PARENT_TYPE', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return;
  }
  if (!ALLOWED_CHILDREN[parentType].includes(childType)) {
    throw new NodeScopeException('PROP_002', 'INVALID_PARENT_TYPE', HttpStatus.UNPROCESSABLE_ENTITY);
  }
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): add Property nesting-rule helper`.

---

## Task 4: `PropertiesRepository` (integration TDD)

**Files:** Create `properties.repository.ts`; test `__tests__/properties.repository.spec.ts`.

- [ ] **Step 1: Write the failing integration test**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PropertiesRepository } from '../properties.repository';

describe('PropertiesRepository (integration)', () => {
  let repo: PropertiesRepository;
  let prisma: PrismaService;
  let orgId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [PropertiesRepository, PrismaService],
    }).compile();
    repo = moduleRef.get(PropertiesRepository);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: `P${Date.now()}${Math.round(performance.now())}` } });
    orgId = org.id;
  });
  afterEach(async () => { await prisma.organization.delete({ where: { id: orgId } }); });

  it('creates a root + child and lists children + subtree ids', async () => {
    const site = await repo.create({ organizationId: orgId, parentId: null, type: 'SITE', name: 'HQ', code: 'hq' });
    const bld = await repo.create({ organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'A', code: 'a' });

    expect(await repo.findChildren(orgId, site.id)).toHaveLength(1);
    const ids = await repo.getSubtreeIds(orgId, site.id);
    expect(ids.sort()).toEqual([site.id, bld.id].sort());
    expect(await repo.isAtOrUnder(orgId, bld.id, site.id)).toBe(true);
    expect(await repo.isAtOrUnder(orgId, site.id, bld.id)).toBe(false);
  });

  it('detects a case-insensitive sibling-name collision (excluding self)', async () => {
    const site = await repo.create({ organizationId: orgId, parentId: null, type: 'SITE', name: 'HQ', code: null });
    await repo.create({ organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'Tower', code: null });
    expect(await repo.existsSiblingName(orgId, site.id, 'tower')).toBe(true);
    expect(await repo.existsSiblingName(orgId, site.id, 'Tower B')).toBe(false);
  });

  it('does not see a property from another org', async () => {
    const other = await prisma.organization.create({ data: { name: `O${Date.now()}` } });
    const p = await repo.create({ organizationId: other.id, parentId: null, type: 'SITE', name: 'X', code: null });
    expect(await repo.findByIdAndOrgId(p.id, orgId)).toBeNull();
    await prisma.organization.delete({ where: { id: other.id } });
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:integration -- properties.repository`.

- [ ] **Step 3: Implement `properties.repository.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma, Property, PropertyType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PropertiesRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: { organizationId: string; parentId: string | null; type: PropertyType; name: string; code: string | null }): Promise<Property> {
    return this.prisma.property.create({ data });
  }

  findByIdAndOrgId(id: string, organizationId: string): Promise<Property | null> {
    return this.prisma.property.findFirst({ where: { id, organizationId } });
  }

  findAllByOrgId(organizationId: string): Promise<Property[]> {
    return this.prisma.property.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } });
  }

  findChildren(organizationId: string, parentId: string): Promise<Property[]> {
    return this.prisma.property.findMany({ where: { organizationId, parentId }, orderBy: { createdAt: 'asc' } });
  }

  countChildren(organizationId: string, parentId: string): Promise<number> {
    return this.prisma.property.count({ where: { organizationId, parentId } });
  }

  async existsSiblingName(organizationId: string, parentId: string | null, name: string, excludeId?: string): Promise<boolean> {
    const hit = await this.prisma.property.findFirst({
      where: {
        organizationId,
        parentId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId && { NOT: { id: excludeId } }),
      },
      select: { id: true },
    });
    return hit !== null;
  }

  async updateWithVersion(id: string, organizationId: string, data: Prisma.PropertyUpdateInput, expectedVersion: number): Promise<Property | null> {
    const res = await this.prisma.property.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count === 0) return null;
    return this.prisma.property.findUnique({ where: { id } });
  }

  async deleteByIdAndOrgId(id: string, organizationId: string): Promise<void> {
    await this.prisma.property.deleteMany({ where: { id, organizationId } });
  }

  /** The property + all descendants (org-scoped), via a recursive CTE. */
  async getSubtreeIds(organizationId: string, rootId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE subtree AS (
        SELECT id FROM "Property" WHERE id = ${rootId} AND "organizationId" = ${organizationId}
        UNION ALL
        SELECT p.id FROM "Property" p JOIN subtree s ON p."parentId" = s.id
      )
      SELECT id FROM subtree;
    `;
    return rows.map((r) => r.id);
  }

  /** True if `descendantId` is `ancestorId` or sits anywhere beneath it (org-scoped). */
  async isAtOrUnder(organizationId: string, descendantId: string, ancestorId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ ok: number }[]>`
      WITH RECURSIVE ancestors AS (
        SELECT id, "parentId" FROM "Property" WHERE id = ${descendantId} AND "organizationId" = ${organizationId}
        UNION ALL
        SELECT p.id, p."parentId" FROM "Property" p JOIN ancestors a ON p.id = a."parentId"
      )
      SELECT 1 AS ok FROM ancestors WHERE id = ${ancestorId} LIMIT 1;
    `;
    return rows.length > 0;
  }
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): add PropertiesRepository with recursive subtree/ancestor queries`.

---

## Task 5: `PropertiesService` + DTOs (unit TDD)

**Files:** Create `properties.service.ts`, `properties.dto.ts`; test `__tests__/properties.service.spec.ts`.

- [ ] **Step 1: DTOs (`properties.dto.ts`)**

```typescript
import { IsString, MinLength, MaxLength, IsEnum, IsOptional, IsUUID, IsInt, Min, IsArray, ArrayMinSize, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PropertyType } from '@prisma/client';
import { ChangesetChangeDto } from '../devices/devices.dto'; // reuse the existing changeset change DTO

export class CreatePropertyDto {
  @IsEnum(PropertyType) type: PropertyType;
  @IsOptional() @IsUUID() parentId?: string;
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(32) code?: string;
}

export const PROPERTY_WRITABLE_FIELDS = ['name', 'code', 'parentId'] as const;

export class PatchPropertyDto {
  @IsInt() @Min(1) baseVersion: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10)
  @ValidateNested({ each: true }) @Type(() => ChangesetChangeDto)
  changes: ChangesetChangeDto[];
}
```

> Confirm the exact location of `ChangesetChangeDto` (F1a Phase A note used `apps/api/src/devices/devices.dto.ts`); match the existing import.

- [ ] **Step 2: Write the failing service test** (mock the repo)

```typescript
import { Test } from '@nestjs/testing';
import { PropertiesService } from '../properties.service';
import { PropertiesRepository } from '../properties.repository';
import { ConflictResolutionService } from '../../conflict/conflict-resolution.service';
import { AuditService } from '../../audit/audit.service';

const repoMock = () => ({
  create: jest.fn(), findByIdAndOrgId: jest.fn(), findAllByOrgId: jest.fn(),
  findChildren: jest.fn(), countChildren: jest.fn(), existsSiblingName: jest.fn(),
  updateWithVersion: jest.fn(), deleteByIdAndOrgId: jest.fn(),
  getSubtreeIds: jest.fn(), isAtOrUnder: jest.fn(),
});
const conflictMock = () => ({ emitEntityEvent: jest.fn(), buildUpdatePayload: jest.fn().mockReturnValue({}) });
const auditMock = () => ({ recordCreate: jest.fn(), recordUpdate: jest.fn(), recordDelete: jest.fn() });

describe('PropertiesService', () => {
  let service: PropertiesService;
  let repo: ReturnType<typeof repoMock>;

  beforeEach(async () => {
    repo = repoMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PropertiesService,
        { provide: PropertiesRepository, useValue: repo },
        { provide: ConflictResolutionService, useValue: conflictMock() },
        { provide: AuditService, useValue: auditMock() },
      ],
    }).compile();
    service = moduleRef.get(PropertiesService);
  });

  it('rejects a non-SITE root (PROP_002)', async () => {
    await expect(service.createProperty('o1', { type: 'BUILDING', name: 'X' } as any)).rejects.toMatchObject({ code: 'PROP_002' });
  });

  it('rejects an illegal child type (PROP_002)', async () => {
    repo.findByIdAndOrgId.mockResolvedValue({ id: 'p1', type: 'SITE', organizationId: 'o1' });
    repo.existsSiblingName.mockResolvedValue(false);
    await expect(service.createProperty('o1', { type: 'FLOOR', parentId: 'p1', name: 'X' } as any)).rejects.toMatchObject({ code: 'PROP_002' });
  });

  it('rejects a duplicate sibling name (PROP_003)', async () => {
    repo.findByIdAndOrgId.mockResolvedValue({ id: 'p1', type: 'SITE', organizationId: 'o1' });
    repo.existsSiblingName.mockResolvedValue(true);
    await expect(service.createProperty('o1', { type: 'BUILDING', parentId: 'p1', name: 'Dup' } as any)).rejects.toMatchObject({ code: 'PROP_003' });
  });

  it('blocks deleting a node with children (PROP_004)', async () => {
    repo.findByIdAndOrgId.mockResolvedValue({ id: 'p1', organizationId: 'o1' });
    repo.countChildren.mockResolvedValue(2);
    await expect(service.deleteProperty('o1', 'p1')).rejects.toMatchObject({ code: 'PROP_004' });
  });

  it('rejects a reparent that would create a cycle (PROP_005)', async () => {
    repo.findByIdAndOrgId
      .mockResolvedValueOnce({ id: 'p1', type: 'SITE', parentId: null, version: 1, organizationId: 'o1' }) // the node
      .mockResolvedValueOnce({ id: 'p2', type: 'SITE', organizationId: 'o1' });                            // the new parent
    repo.getSubtreeIds.mockResolvedValue(['p1', 'p2']); // p2 is under p1 → cycle
    await expect(service.updateProperty('o1', 'p1', { baseVersion: 1, changes: [{ field: 'parentId', oldValue: null, newValue: 'p2' }] } as any))
      .rejects.toMatchObject({ code: 'PROP_005' });
  });
});
```

- [ ] **Step 3: Run → FAIL.** `cd apps/api && npm run test:unit -- properties.service`.

- [ ] **Step 4: Implement `properties.service.ts`**

```typescript
import { HttpStatus, Injectable } from '@nestjs/common';
import { Property, PropertyType } from '@prisma/client';
import { PropertyDto } from '@nodescope/shared';
import { WS_EVENTS } from '@nodescope/shared';
import { PropertiesRepository } from './properties.repository';
import { ConflictResolutionService } from '../conflict/conflict-resolution.service';
import { AuditService } from '../audit/audit.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { assertValidNesting } from './property-nesting';
import { CreatePropertyDto, PatchPropertyDto, PROPERTY_WRITABLE_FIELDS } from './properties.dto';

@Injectable()
export class PropertiesService {
  constructor(
    private readonly repo: PropertiesRepository,
    private readonly conflict: ConflictResolutionService,
    private readonly audit: AuditService,
  ) {}

  async listProperties(organizationId: string): Promise<PropertyDto[]> {
    return (await this.repo.findAllByOrgId(organizationId)).map((p) => this.toDto(p));
  }

  async getProperty(organizationId: string, id: string): Promise<PropertyDto> {
    const p = await this.repo.findByIdAndOrgId(id, organizationId);
    if (!p) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);
    return this.toDto(p);
  }

  async createProperty(organizationId: string, dto: CreatePropertyDto): Promise<PropertyDto> {
    const parentType = await this.resolveParentType(organizationId, dto.parentId ?? null);
    assertValidNesting(parentType, dto.type);
    if (await this.repo.existsSiblingName(organizationId, dto.parentId ?? null, dto.name)) {
      throw new NodeScopeException('PROP_003', 'PROPERTY_NAME_TAKEN', HttpStatus.CONFLICT);
    }
    const created = await this.repo.create({
      organizationId, parentId: dto.parentId ?? null, type: dto.type, name: dto.name, code: dto.code ?? null,
    });
    this.conflict.emitEntityEvent(WS_EVENTS.PROPERTY_CREATED, { id: created.id }, organizationId);
    await this.audit.recordCreate(organizationId, 'Property', created);
    return this.toDto(created);
  }

  async updateProperty(organizationId: string, id: string, patch: PatchPropertyDto): Promise<PropertyDto> {
    const current = await this.repo.findByIdAndOrgId(id, organizationId);
    if (!current) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);

    const changedField = (f: string) => patch.changes.find((c) => c.field === f);
    const parentChange = changedField('parentId');
    const nameChange = changedField('name');

    const nextParentId = parentChange ? ((parentChange.newValue as string | null) ?? null) : current.parentId;

    if (parentChange) {
      // cycle: the new parent must not be the node itself or any of its descendants
      if (nextParentId) {
        if (nextParentId === id) throw new NodeScopeException('PROP_005', 'PROPERTY_CYCLE', HttpStatus.UNPROCESSABLE_ENTITY);
        const subtree = await this.repo.getSubtreeIds(organizationId, id);
        if (subtree.includes(nextParentId)) throw new NodeScopeException('PROP_005', 'PROPERTY_CYCLE', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      const newParentType = await this.resolveParentType(organizationId, nextParentId);
      assertValidNesting(newParentType, current.type);
      // NOTE: containment re-validation (devices/charters) is added in Phase B.
    }

    if (nameChange || parentChange) {
      const nextName = nameChange ? (nameChange.newValue as string) : current.name;
      if (await this.repo.existsSiblingName(organizationId, nextParentId, nextName, id)) {
        throw new NodeScopeException('PROP_003', 'PROPERTY_NAME_TAKEN', HttpStatus.CONFLICT);
      }
    }

    const payload = this.conflict.buildUpdatePayload(patch, PROPERTY_WRITABLE_FIELDS, current.version, CreatePropertyDto);
    const updated = await this.repo.updateWithVersion(id, organizationId, payload, patch.baseVersion);
    if (!updated) throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);

    const event = parentChange ? WS_EVENTS.PROPERTY_MOVED : WS_EVENTS.PROPERTY_UPDATED;
    this.conflict.emitEntityEvent(event, { id }, organizationId);
    await this.audit.recordUpdate(organizationId, 'Property', id, patch.changes);
    return this.toDto(updated);
  }

  async deleteProperty(organizationId: string, id: string): Promise<void> {
    const p = await this.repo.findByIdAndOrgId(id, organizationId);
    if (!p) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);
    if ((await this.repo.countChildren(organizationId, id)) > 0) {
      throw new NodeScopeException('PROP_004', 'PROPERTY_NOT_EMPTY', HttpStatus.CONFLICT);
    }
    // NOTE: Phase B also blocks on placed devices and network charters before deleting.
    await this.repo.deleteByIdAndOrgId(id, organizationId);
    this.conflict.emitEntityEvent(WS_EVENTS.PROPERTY_DELETED, { id }, organizationId);
    await this.audit.recordDelete(organizationId, 'Property', p);
  }

  // ---- helpers exposed for Phase B containment + F3 (spec §10.2) ----
  subtreePropertyIds(organizationId: string, id: string): Promise<string[]> {
    return this.repo.getSubtreeIds(organizationId, id);
  }
  isAtOrUnder(organizationId: string, descendantId: string, ancestorId: string): Promise<boolean> {
    return this.repo.isAtOrUnder(organizationId, descendantId, ancestorId);
  }

  private async resolveParentType(organizationId: string, parentId: string | null): Promise<PropertyType | null> {
    if (!parentId) return null;
    const parent = await this.repo.findByIdAndOrgId(parentId, organizationId);
    if (!parent) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);
    return parent.type;
  }

  private toDto(p: Property): PropertyDto {
    return {
      id: p.id, organizationId: p.organizationId, parentId: p.parentId, type: p.type,
      name: p.name, code: p.code, version: p.version,
      createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
    };
  }
}
```

> Confirm the `@nodescope/shared` alias and `WS_EVENTS` import path against an existing service (e.g. `devices.service.ts`).

- [ ] **Step 5: Run → PASS.** Commit `feat(api): add PropertiesService (CRUD, nesting, cycle-safe reparent, delete-block)`.

---

## Task 6: `PropertiesController` + module wiring (e2e)

**Files:** Create `properties.controller.ts`, `properties.module.ts`; modify `app.module.ts`; test `__tests__/properties.e2e-spec.ts`.

- [ ] **Step 1: Implement the controller**

```typescript
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { OrgContextGuard } from '../organizations/guards/org-context.guard';
import { OrgRoleGuard } from '../organizations/guards/org-role.guard';
import { OrgRoles } from '../organizations/decorators/org-roles.decorator';
import { OrgId } from '../organizations/decorators/org-id.decorator';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto, PatchPropertyDto } from './properties.dto';

@Controller('v1/properties')
@UseGuards(AuthGuard, OrgContextGuard, OrgRoleGuard)
export class PropertiesController {
  constructor(private readonly service: PropertiesService) {}

  @Get()
  async list(@OrgId() orgId: string) {
    return { success: true, data: await this.service.listProperties(orgId), timestamp: new Date().toISOString() };
  }

  @Get(':id')
  async get(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return { success: true, data: await this.service.getProperty(orgId, id), timestamp: new Date().toISOString() };
  }

  @Post()
  @OrgRoles('OWNER', 'ADMIN')
  async create(@OrgId() orgId: string, @Body() dto: CreatePropertyDto) {
    return { success: true, data: await this.service.createProperty(orgId, dto), timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  @OrgRoles('OWNER', 'ADMIN')
  async update(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() patch: PatchPropertyDto) {
    return { success: true, data: await this.service.updateProperty(orgId, id, patch), timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  @OrgRoles('OWNER', 'ADMIN')
  async remove(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteProperty(orgId, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
```

> If Phase B (F1a) registered `OrgContextGuard` as a global `APP_GUARD`, drop it from `@UseGuards` here (keep `AuthGuard` + `OrgRoleGuard`). Both forms are correct.

- [ ] **Step 2: Implement the module**

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ConflictModule } from '../conflict/conflict.module';
import { PropertiesRepository } from './properties.repository';
import { PropertiesService } from './properties.service';
import { PropertiesController } from './properties.controller';

@Module({
  imports: [PrismaModule, OrganizationsModule, ConflictModule],
  controllers: [PropertiesController],
  providers: [PropertiesRepository, PropertiesService],
  exports: [PropertiesRepository, PropertiesService],
})
export class PropertiesModule {}
```

`AuditService` is global (`AuditModule` from F1a Phase C), so it needs no import here. Confirm `ConflictModule` exports `ConflictResolutionService` and `OrganizationsModule` exports what the guards need; adjust to match existing module exports.

- [ ] **Step 3: Register in `app.module.ts`.** Add `PropertiesModule` to the `imports` array.

- [ ] **Step 4: Write the failing e2e test** (mirror the F1a org e2e auth-override with a mutable `currentUser`)

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

describe('Properties (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let currentUser: { id: string; isSuperAdmin: boolean };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: (ctx: any) => { ctx.switchToHttp().getRequest().user = currentUser; return true; } })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  it('OWNER builds a tree; MEMBER is read-only; nesting + uniqueness + delete-block enforced', async () => {
    const org = await prisma.organization.create({ data: { name: `E2E${Date.now()}` } });
    const owner = await prisma.user.create({ data: { email: `o-${Date.now()}@x.com`, emailVerified: true, name: 'O' } });
    const member = await prisma.user.create({ data: { email: `m-${Date.now()}@x.com`, emailVerified: true, name: 'M' } });
    await prisma.organizationMember.create({ data: { userId: owner.id, organizationId: org.id, role: 'OWNER' } });
    await prisma.organizationMember.create({ data: { userId: member.id, organizationId: org.id, role: 'MEMBER' } });
    const server = app.getHttpServer();

    currentUser = { id: owner.id, isSuperAdmin: false };
    const site = (await request(server).post('/v1/properties').send({ type: 'SITE', name: 'HQ', code: 'hq' }).expect(201)).body.data;
    await request(server).post('/v1/properties').send({ type: 'BUILDING', name: 'A', parentId: site.id }).expect(201);

    // illegal nesting
    const bad = await request(server).post('/v1/properties').send({ type: 'FLOOR', name: 'F', parentId: site.id }).expect(422);
    expect(bad.body.code).toBe('PROP_002');
    // duplicate sibling
    const dup = await request(server).post('/v1/properties').send({ type: 'BUILDING', name: 'a', parentId: site.id }).expect(409);
    expect(dup.body.code).toBe('PROP_003');
    // delete-block (SITE has a child)
    const del = await request(server).delete(`/v1/properties/${site.id}`).expect(409);
    expect(del.body.code).toBe('PROP_004');

    // member can read, cannot write
    currentUser = { id: member.id, isSuperAdmin: false };
    await request(server).get('/v1/properties').expect(200);
    const forbidden = await request(server).post('/v1/properties').send({ type: 'SITE', name: 'Nope' }).expect(403);
    expect(forbidden.body.code).toBe('ORG_003');

    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, member.id] } } });
  });
});
```

- [ ] **Step 5: Run → first FAIL, then PASS** after Steps 1-3. `cd apps/api && npm run test:e2e -- properties`.

- [ ] **Step 6: Commit** `feat(api): add PropertiesController + wire PropertiesModule`.

---

## Task 7: Full suite + docs

- [ ] **Step 1: Run the full backend suite.** `cd apps/api && npm run test:unit && npm run test:integration && npm run test:e2e` → all green.
- [ ] **Step 2: Docs (Rule 10).** Confirm `PROP_001`–`PROP_005` and `v1:property:*` are in the API Design Document; note the Property hierarchy in the SAD.
- [ ] **Step 3: Commit** `docs: document the Property tree; test: full suite green`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage (Phase A subset):** `Property` model + `PropertyType` (§4.1) ✓ Task 1; sibling-unique case-insensitive index (§4.7) ✓ Task 1 Step 3; nesting rules (§5) ✓ Tasks 3, 5; root-must-be-SITE (§5) ✓ Task 3; cycle-safe reparent (§5) ✓ Task 5; delete-block on children (§5) ✓ Task 5 (devices/charters → Phase B, flagged); subtree/`isAtOrUnder` anchor (§10.2) ✓ Tasks 4-5; DTOs/events/error codes (§10.1/10.3/10.4) ✓ Task 2; OWNER/ADMIN mutate + member read (§8) ✓ Task 6. Deferred to Phase B (correct): device placement, charters, containment, delete-block on devices/charters, reparent containment re-validation.
- **Type consistency:** repo methods (`findByIdAndOrgId`, `findChildren`, `countChildren`, `existsSiblingName(...excludeId?)`, `updateWithVersion(id, orgId, data, version)`, `getSubtreeIds`, `isAtOrUnder(orgId, descendantId, ancestorId)`) are referenced identically in service + tests. `assertValidNesting(parentType|null, childType)` signature matches helper + service. `PROPERTY_WRITABLE_FIELDS` = `['name','code','parentId']`; `type` is intentionally not writable.
- **Integration points to verify during execution:** the `@nodescope/shared` alias + `WS_EVENTS` import (Task 5), the `ChangesetChangeDto` location (Task 5), `buildUpdatePayload`'s exact signature (F1a), whether `OrgContextGuard` is a global `APP_GUARD` (Task 6), and the e2e `AuthGuard`-override mechanism (Task 6) — each against the named existing file.
- **Build-green:** purely additive; nothing touches `Device`/`Network`, so the suite stays green throughout.
