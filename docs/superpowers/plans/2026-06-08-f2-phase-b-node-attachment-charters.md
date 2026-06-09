# F2 Phase B — Node Attachment & Network Charters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the network model *located*: retire `BROWSER_CLIENT`, make `Device.networkId` required, add required `Device.propertyId` (+ optional `roleCode`), drop the obsolete `Network.propertyId`, introduce the `NetworkProperty` charter (which sites a network serves), and enforce **containment** (a device may only sit at/under one of its network's chartered sites) on device create/move, charter removal, and property reparent.

**Architecture:** A `NetworkProperty` model and charter repo/service/controller live in `PropertiesModule` (they relate properties↔networks; keeping them here avoids a devices↔properties module cycle). A `ContainmentService` (also in `PropertiesModule`) owns the placement/charter/reparent invariants. `DevicesModule` imports `PropertiesModule` and calls `ContainmentService` on create/move; `PropertiesModule` never imports `DevicesModule` — its cross-table counts go through Prisma directly. The schema change reddens the build; modules are fixed task-by-task back to green.

**Tech Stack:** NestJS, Prisma 5, PostgreSQL 16, Jest. Repository pattern, TDD, `NodeScopeException`, recursive-CTE ancestor/subtree queries.

**Depends on:** F2 **Phase A** (`Property`, `PropertiesRepository` with `getSubtreeIds`/`isAtOrUnder`, `PropertiesService`, `PropertiesModule`) and F1a Phase B (devices org-scoped, `DevicesRepository`/`DevicesService`/`DevicesController`). Spec: `2026-06-08-f2-sites-node-grouping-design.md` (§4.2–4.6, §6, §10).

> **Precondition (§4.5):** the `BROWSER_CLIENT` retirement is part of this phase's migration. Before Task 1, grep the codebase for `BROWSER_CLIENT` and `browserDeviceId` and confirm nothing outside the device module (notably realtime presence) depends on them; if it does, remove those usages in the same task.

---

## File Structure

**Create:**
- `apps/api/src/properties/network-property.repository.ts`
- `apps/api/src/properties/network-property.service.ts`
- `apps/api/src/properties/network-property.controller.ts` (`/v1/networks/:networkId/properties`)
- `apps/api/src/properties/containment.service.ts`
- `apps/api/src/properties/network-property.dto.ts`
- `__tests__/` specs for the above

**Modify:**
- `apps/api/prisma/schema.prisma` — `NetworkProperty`; `Device` (`networkId` NOT NULL, `propertyId`, `roleCode`); `Network` (drop `propertyId`); retire `BROWSER_CLIENT`/`browserDeviceId`
- `apps/api/src/properties/properties.repository.ts` — `getAncestorIds`, `devicesUnder`, `countDevicesUnder`, `countChartersUnder`
- `apps/api/src/properties/properties.service.ts` — delete-block on devices/charters; reparent containment re-validation
- `apps/api/src/properties/properties.module.ts` — register charter + containment providers/controller; export `ContainmentService`, `NetworkPropertyRepository`
- `apps/api/src/devices/devices.repository.ts` / `devices.service.ts` / `devices.controller.ts` / `devices.dto.ts` — `propertyId` + `roleCode` + containment
- `apps/api/src/devices/devices.module.ts` — import `PropertiesModule`
- `packages/shared/src/types/api.types.ts`, `realtime.types.ts`
- `apps/api/prisma/seed.ts`

---

## Task 1: Schema — retire `BROWSER_CLIENT`, re-attach `Device`, add `NetworkProperty`, drop `Network.propertyId`

**Files:** Modify `apps/api/prisma/schema.prisma`; generated migration.

- [ ] **Step 1: Retire `BROWSER_CLIENT`.** Remove `BROWSER_CLIENT` from the `DeviceCategory` enum; remove `Device.browserDeviceId` and its `@@unique([organizationId, browserDeviceId])`.

- [ ] **Step 2: Re-attach `Device`.**

```prisma
model Device {
  // ... existing fields ...
  networkId  String   // was String? → NOT NULL
  propertyId String   // NEW, NOT NULL
  roleCode   String?  // NEW

  network  Network  @relation(fields: [networkId], references: [id], onDelete: Restrict)
  property Property @relation(fields: [propertyId], references: [id], onDelete: Restrict)
  // ... other relations unchanged ...

  @@index([organizationId, propertyId])
  // keep existing @@index lines
}
```

- [ ] **Step 3: Drop `Network.propertyId`; add the back-relation.** Remove the `propertyId` field and its `property` relation from `Network`; add `networkLinks NetworkProperty[]`. (Leave `homeLatitude`/`homeLongitude`/`homeAddress`.)

- [ ] **Step 4: Add `NetworkProperty`** (spec §4.2)

```prisma
model NetworkProperty {
  id             String   @id @default(uuid())
  organizationId String
  networkId      String
  propertyId     String
  createdAt      DateTime @default(now())

  network      Network      @relation(fields: [networkId], references: [id], onDelete: Cascade)
  property     Property     @relation(fields: [propertyId], references: [id], onDelete: Restrict)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([networkId, propertyId])
  @@index([organizationId])
  @@index([propertyId])
}
```

Add back-relations: `Organization { networkProperties NetworkProperty[] }`, `Property { networkLinks NetworkProperty[] }`.

- [ ] **Step 5: Migrate.** `cd apps/api && npx prisma migrate dev --name f2_node_attachment_charters` then `npx prisma migrate reset --force` (greenfield).

- [ ] **Step 6:** `npx tsc --noEmit` → **expected FAIL** (device/network/seed code still references old fields — fixed in Tasks 6-8). Commit anyway:

```bash
git add apps/api/prisma
git commit -m "feat(api): retire BROWSER_CLIENT, attach Device to network+property, add NetworkProperty"
```

---

## Task 2: Shared DTOs, WS events, error codes

**Files:** Modify `packages/shared/src/types/api.types.ts`, `realtime.types.ts`; API Design Document.

- [ ] **Step 1:** In `api.types.ts`: remove `'BROWSER_CLIENT'` from the `DeviceCategory` union (if present); add to `DeviceDto`: `propertyId: string;` and `roleCode: string | null;`. Add:

```typescript
export interface NetworkPropertyDto { id: string; networkId: string; propertyId: string; }
```

- [ ] **Step 2:** In `realtime.types.ts` add to `WS_EVENTS`:

```typescript
NETWORK_CHARTER_ADDED:   'v1:network:charter:added',
NETWORK_CHARTER_REMOVED: 'v1:network:charter:removed',
```

- [ ] **Step 3: Build shared.** `cd packages/shared && npm run build` → PASS.

- [ ] **Step 4: Register `PROP_006`–`PROP_008`** in the API Design Document: `PROP_006 CHARTER_EXISTS` (409), `PROP_007 DEVICE_NOT_IN_CHARTERED_SITE` (422), `PROP_008 CHARTER_IN_USE` (409).

- [ ] **Step 5: Commit** `feat(shared): device propertyId/roleCode, NetworkPropertyDto, charter events; docs: PROP_006-008`.

---

## Task 3: `NetworkPropertyRepository` + `PropertiesRepository` extensions (integration TDD)

**Files:** Create `network-property.repository.ts`; modify `properties.repository.ts`; tests.

- [ ] **Step 1: Write the failing integration test** covering: charter create + `propertyIdsByNetwork`; `existsCharter`; `getAncestorIds` returns self+ancestors; `countDevicesUnder`/`countChartersUnder`. (Seed an org, a SITE→BUILDING, a network, a device.)

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:integration -- network-property.repository`.

- [ ] **Step 3: Implement `NetworkPropertyRepository`**

```typescript
import { Injectable } from '@nestjs/common';
import { NetworkProperty } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NetworkPropertyRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(organizationId: string, networkId: string, propertyId: string): Promise<NetworkProperty> {
    return this.prisma.networkProperty.create({ data: { organizationId, networkId, propertyId } });
  }
  existsCharter(organizationId: string, networkId: string, propertyId: string): Promise<NetworkProperty | null> {
    return this.prisma.networkProperty.findFirst({ where: { organizationId, networkId, propertyId } });
  }
  findByIdAndOrg(id: string, organizationId: string): Promise<NetworkProperty | null> {
    return this.prisma.networkProperty.findFirst({ where: { id, organizationId } });
  }
  listByNetwork(organizationId: string, networkId: string): Promise<NetworkProperty[]> {
    return this.prisma.networkProperty.findMany({ where: { organizationId, networkId }, orderBy: { createdAt: 'asc' } });
  }
  async propertyIdsByNetwork(organizationId: string, networkId: string): Promise<string[]> {
    const rows = await this.prisma.networkProperty.findMany({ where: { organizationId, networkId }, select: { propertyId: true } });
    return rows.map((r) => r.propertyId);
  }
  async deleteByNetworkAndProperty(organizationId: string, networkId: string, propertyId: string): Promise<number> {
    const res = await this.prisma.networkProperty.deleteMany({ where: { organizationId, networkId, propertyId } });
    return res.count;
  }
}
```

- [ ] **Step 4: Extend `PropertiesRepository`** (add these methods)

```typescript
/** Self + all ancestors (org-scoped), via an upward recursive CTE. */
async getAncestorIds(organizationId: string, id: string): Promise<string[]> {
  const rows = await this.prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE ancestors AS (
      SELECT id, "parentId" FROM "Property" WHERE id = ${id} AND "organizationId" = ${organizationId}
      UNION ALL
      SELECT p.id, p."parentId" FROM "Property" p JOIN ancestors a ON p.id = a."parentId"
    )
    SELECT id FROM ancestors;`;
  return rows.map((r) => r.id);
}

devicesUnder(organizationId: string, propertyIds: string[]): Promise<{ id: string; networkId: string; propertyId: string }[]> {
  if (propertyIds.length === 0) return Promise.resolve([]);
  return this.prisma.device.findMany({
    where: { organizationId, propertyId: { in: propertyIds } },
    select: { id: true, networkId: true, propertyId: true },
  });
}

countDevicesUnder(organizationId: string, propertyIds: string[]): Promise<number> {
  if (propertyIds.length === 0) return Promise.resolve(0);
  return this.prisma.device.count({ where: { organizationId, propertyId: { in: propertyIds } } });
}

countChartersUnder(organizationId: string, propertyIds: string[]): Promise<number> {
  if (propertyIds.length === 0) return Promise.resolve(0);
  return this.prisma.networkProperty.count({ where: { organizationId, propertyId: { in: propertyIds } } });
}
```

- [ ] **Step 5: Run → PASS.** Commit `feat(api): NetworkPropertyRepository + property ancestor/usage queries`.

---

## Task 4: `ContainmentService` (unit TDD)

**Files:** Create `containment.service.ts`; test `__tests__/containment.service.spec.ts`.

- [ ] **Step 1: Write the failing test** — `assertDevicePlacement` passes when the property is at/under a charter and throws `PROP_007` otherwise; `assertReparentKeepsContainment` throws `PROP_007` when a move would orphan a placed device; `assertCharterRemovable` throws `PROP_008` when a device relies on the only covering charter.

```typescript
import { Test } from '@nestjs/testing';
import { ContainmentService } from '../containment.service';
import { PropertiesRepository } from '../properties.repository';
import { NetworkPropertyRepository } from '../network-property.repository';

const propsMock = () => ({ getAncestorIds: jest.fn(), getSubtreeIds: jest.fn(), devicesUnder: jest.fn() });
const charterMock = () => ({ propertyIdsByNetwork: jest.fn() });

describe('ContainmentService', () => {
  let svc: ContainmentService; let props: ReturnType<typeof propsMock>; let charters: ReturnType<typeof charterMock>;
  beforeEach(async () => {
    props = propsMock(); charters = charterMock();
    const m = await Test.createTestingModule({ providers: [
      ContainmentService,
      { provide: PropertiesRepository, useValue: props },
      { provide: NetworkPropertyRepository, useValue: charters },
    ] }).compile();
    svc = m.get(ContainmentService);
  });

  it('allows placement at/under a chartered site', async () => {
    props.getAncestorIds.mockResolvedValue(['floor1', 'bldgA', 'siteHQ']);
    charters.propertyIdsByNetwork.mockResolvedValue(['siteHQ']);
    await expect(svc.assertDevicePlacement('o1', 'net1', 'floor1')).resolves.toBeUndefined();
  });

  it('rejects placement outside every charter (PROP_007)', async () => {
    props.getAncestorIds.mockResolvedValue(['floor1', 'bldgA', 'siteHQ']);
    charters.propertyIdsByNetwork.mockResolvedValue(['siteOther']);
    await expect(svc.assertDevicePlacement('o1', 'net1', 'floor1')).rejects.toMatchObject({ code: 'PROP_007' });
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:unit -- containment.service`.

- [ ] **Step 3: Implement `containment.service.ts`**

```typescript
import { HttpStatus, Injectable } from '@nestjs/common';
import { PropertiesRepository } from './properties.repository';
import { NetworkPropertyRepository } from './network-property.repository';
import { NodeScopeException } from '../common/filters/global-exception.filter';

@Injectable()
export class ContainmentService {
  constructor(
    private readonly props: PropertiesRepository,
    private readonly charters: NetworkPropertyRepository,
  ) {}

  /** PROP_007 unless `propertyId` is at/under one of `networkId`'s chartered sites. */
  async assertDevicePlacement(organizationId: string, networkId: string, propertyId: string): Promise<void> {
    const ancestors = await this.props.getAncestorIds(organizationId, propertyId);
    const charterProps = await this.charters.propertyIdsByNetwork(organizationId, networkId);
    if (!this.intersects(ancestors, charterProps)) {
      throw new NodeScopeException('PROP_007', 'DEVICE_NOT_IN_CHARTERED_SITE', HttpStatus.UNPROCESSABLE_ENTITY);
    }
  }

  /**
   * PROP_007 if moving `movedId` under `newParentId` would orphan any placed device in the moved subtree.
   * Post-move ancestors of a device d = (d's ancestors that stay within the moved subtree) ∪ (newParent + its ancestors).
   */
  async assertReparentKeepsContainment(organizationId: string, movedId: string, newParentId: string | null): Promise<void> {
    const subtree = await this.props.getSubtreeIds(organizationId, movedId);
    const devices = await this.props.devicesUnder(organizationId, subtree);
    if (devices.length === 0) return;
    const newAbove = newParentId ? await this.props.getAncestorIds(organizationId, newParentId) : [];
    const subtreeSet = new Set(subtree);
    const charterCache = new Map<string, string[]>();

    for (const d of devices) {
      const dAnc = await this.props.getAncestorIds(organizationId, d.propertyId);
      const withinMoved = dAnc.filter((a) => subtreeSet.has(a)); // d up to movedId, unchanged
      const post = new Set<string>([...withinMoved, ...newAbove]);
      let charterProps = charterCache.get(d.networkId);
      if (!charterProps) { charterProps = await this.charters.propertyIdsByNetwork(organizationId, d.networkId); charterCache.set(d.networkId, charterProps); }
      if (!charterProps.some((c) => post.has(c))) {
        throw new NodeScopeException('PROP_007', 'DEVICE_NOT_IN_CHARTERED_SITE', HttpStatus.UNPROCESSABLE_ENTITY);
      }
    }
  }

  /** PROP_008 if removing charter (networkId, propertyId) leaves any of that network's devices uncovered. */
  async assertCharterRemovable(organizationId: string, networkId: string, propertyId: string): Promise<void> {
    const removedSubtree = await this.props.getSubtreeIds(organizationId, propertyId);
    const devices = (await this.props.devicesUnder(organizationId, removedSubtree)).filter((d) => d.networkId === networkId);
    if (devices.length === 0) return;
    const remaining = (await this.charters.propertyIdsByNetwork(organizationId, networkId)).filter((p) => p !== propertyId);
    for (const d of devices) {
      const ancestors = await this.props.getAncestorIds(organizationId, d.propertyId);
      if (!this.intersects(ancestors, remaining)) {
        throw new NodeScopeException('PROP_008', 'CHARTER_IN_USE', HttpStatus.CONFLICT);
      }
    }
  }

  private intersects(a: string[], b: string[]): boolean {
    const set = new Set(a);
    return b.some((x) => set.has(x));
  }
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): ContainmentService (placement, reparent, charter-removal invariants)`.

---

## Task 5: Charter service + controller (TDD + e2e)

**Files:** Create `network-property.service.ts`, `network-property.controller.ts`, `network-property.dto.ts`; tests.

- [ ] **Step 1: DTO** (`network-property.dto.ts`)

```typescript
import { IsUUID } from 'class-validator';
export class AddCharterDto { @IsUUID() propertyId: string; }
```

- [ ] **Step 2: Write the failing service test** — add rejects a duplicate (`PROP_006`); add validates the property exists in-org (`PROP_001`); remove calls `assertCharterRemovable` then deletes; emits `NETWORK_CHARTER_ADDED`/`REMOVED`.

- [ ] **Step 3: Implement `NetworkPropertyService`**

```typescript
import { HttpStatus, Injectable } from '@nestjs/common';
import { WS_EVENTS } from '@nodescope/shared';
import { NetworkPropertyRepository } from './network-property.repository';
import { PropertiesRepository } from './properties.repository';
import { ContainmentService } from './containment.service';
import { ConflictResolutionService } from '../conflict/conflict-resolution.service';
import { AuditService } from '../audit/audit.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';

@Injectable()
export class NetworkPropertyService {
  constructor(
    private readonly charters: NetworkPropertyRepository,
    private readonly props: PropertiesRepository,
    private readonly containment: ContainmentService,
    private readonly conflict: ConflictResolutionService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, networkId: string) {
    return (await this.charters.listByNetwork(organizationId, networkId)).map((c) => ({ id: c.id, networkId: c.networkId, propertyId: c.propertyId }));
  }

  async add(organizationId: string, networkId: string, propertyId: string) {
    const property = await this.props.findByIdAndOrgId(propertyId, organizationId);
    if (!property) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (await this.charters.existsCharter(organizationId, networkId, propertyId)) {
      throw new NodeScopeException('PROP_006', 'CHARTER_EXISTS', HttpStatus.CONFLICT);
    }
    const created = await this.charters.create(organizationId, networkId, propertyId);
    this.conflict.emitEntityEvent(WS_EVENTS.NETWORK_CHARTER_ADDED, { id: created.id, networkId, propertyId }, organizationId);
    await this.audit.recordCreate(organizationId, 'NetworkProperty', created);
    return { id: created.id, networkId, propertyId };
  }

  async remove(organizationId: string, networkId: string, propertyId: string) {
    const existing = await this.charters.existsCharter(organizationId, networkId, propertyId);
    if (!existing) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.containment.assertCharterRemovable(organizationId, networkId, propertyId);
    await this.charters.deleteByNetworkAndProperty(organizationId, networkId, propertyId);
    this.conflict.emitEntityEvent(WS_EVENTS.NETWORK_CHARTER_REMOVED, { networkId, propertyId }, organizationId);
    await this.audit.recordDelete(organizationId, 'NetworkProperty', existing);
  }
}
```

- [ ] **Step 4: Run service test → PASS.**

- [ ] **Step 5: Implement the controller** (`/v1/networks/:networkId/properties`, mutations OWNER/ADMIN)

```typescript
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { OrgContextGuard } from '../organizations/guards/org-context.guard';
import { OrgRoleGuard } from '../organizations/guards/org-role.guard';
import { OrgRoles } from '../organizations/decorators/org-roles.decorator';
import { OrgId } from '../organizations/decorators/org-id.decorator';
import { NetworkPropertyService } from './network-property.service';
import { AddCharterDto } from './network-property.dto';

@Controller('v1/networks/:networkId/properties')
@UseGuards(AuthGuard, OrgContextGuard, OrgRoleGuard)
export class NetworkPropertyController {
  constructor(private readonly service: NetworkPropertyService) {}

  @Get()
  async list(@OrgId() orgId: string, @Param('networkId', ParseUUIDPipe) networkId: string) {
    return { success: true, data: await this.service.list(orgId, networkId), timestamp: new Date().toISOString() };
  }

  @Post()
  @OrgRoles('OWNER', 'ADMIN')
  async add(@OrgId() orgId: string, @Param('networkId', ParseUUIDPipe) networkId: string, @Body() dto: AddCharterDto) {
    return { success: true, data: await this.service.add(orgId, networkId, dto.propertyId), timestamp: new Date().toISOString() };
  }

  @Delete(':propertyId')
  @OrgRoles('OWNER', 'ADMIN')
  async remove(@OrgId() orgId: string, @Param('networkId', ParseUUIDPipe) networkId: string, @Param('propertyId', ParseUUIDPipe) propertyId: string) {
    await this.service.remove(orgId, networkId, propertyId);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
```

- [ ] **Step 6: Commit** `feat(api): network-property charters (add/list/remove) with PROP_006/008`.

---

## Task 6: Extend `PropertiesService` — delete-block on devices/charters + reparent re-validation

**Files:** Modify `properties.service.ts`; update `__tests__/properties.service.spec.ts`.

- [ ] **Step 1: Inject `ContainmentService`** into `PropertiesService` (append to the constructor — do not reorder existing deps).

- [ ] **Step 2: Replace the delete-block** in `deleteProperty` so it checks the whole subtree for children, devices, and charters:

```typescript
async deleteProperty(organizationId: string, id: string): Promise<void> {
  const p = await this.repo.findByIdAndOrgId(id, organizationId);
  if (!p) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);
  const subtreeIds = await this.repo.getSubtreeIds(organizationId, id);
  const hasChildren = subtreeIds.length > 1;
  const devices = await this.repo.countDevicesUnder(organizationId, subtreeIds);
  const charters = await this.repo.countChartersUnder(organizationId, subtreeIds);
  if (hasChildren || devices > 0 || charters > 0) {
    throw new NodeScopeException('PROP_004', 'PROPERTY_NOT_EMPTY', HttpStatus.CONFLICT);
  }
  await this.repo.deleteByIdAndOrgId(id, organizationId);
  this.conflict.emitEntityEvent(WS_EVENTS.PROPERTY_DELETED, { id }, organizationId);
  await this.audit.recordDelete(organizationId, 'Property', p);
}
```

- [ ] **Step 3: Add reparent containment re-validation** in `updateProperty` — after the cycle + nesting checks, before the write, when `parentChange` is present:

```typescript
await this.containment.assertReparentKeepsContainment(organizationId, id, nextParentId);
```

- [ ] **Step 4: Update the service test** — add: delete blocked by a placed device (`PROP_004`); delete blocked by a charter (`PROP_004`); reparent that would orphan a device (`PROP_007`). Mock `ContainmentService` accordingly.

- [ ] **Step 5: Run → PASS.** Commit `feat(api): Property delete-block on devices/charters + reparent containment re-validation`.

---

## Task 7: Re-attach the `Device` module (fix compile, add containment)

**Files:** Modify `devices.dto.ts`, `devices.repository.ts`, `devices.service.ts`, `devices.controller.ts`, `devices.module.ts`; update device tests.

- [ ] **Step 1: DTO.** In `devices.dto.ts`, add to `CreateDeviceDto`: `@IsUUID() propertyId: string;` and `@IsOptional() @IsString() @MaxLength(32) roleCode?: string;`. Remove any `browserDeviceId` field. Add `propertyId`/`roleCode` to `DEVICE_WRITABLE_FIELDS` so they can be patched (placement moves go through the patch path).

- [ ] **Step 2: Repository.** In `devices.repository.ts`, the `create` data now includes `networkId`, `propertyId`, `roleCode`; remove `browserDeviceId` references. (Method signatures from F1a Phase B are otherwise unchanged.)

- [ ] **Step 3: Service — require network + containment on create.** In `DevicesService`, inject `ContainmentService` (append to constructor). In `createDevice(organizationId, creatorUserId, dto)`, before `repository.create`:

```typescript
await this.containment.assertDevicePlacement(organizationId, dto.networkId, dto.propertyId);
```

(Keep the F1a naming-policy checks. `networkId`/`propertyId` come from `dto`, both required by validation.)

- [ ] **Step 4: Service — containment on move.** In `updateDevice`, if the patch changes `propertyId` (or `networkId`), resolve the post-patch `networkId`/`propertyId` and call `assertDevicePlacement` before `updateWithVersion`:

```typescript
const nextNetworkId = (patch.changes.find((c) => c.field === 'networkId')?.newValue as string) ?? device.networkId;
const nextPropertyId = (patch.changes.find((c) => c.field === 'propertyId')?.newValue as string) ?? device.propertyId;
if (patch.changes.some((c) => c.field === 'propertyId' || c.field === 'networkId')) {
  await this.containment.assertDevicePlacement(organizationId, nextNetworkId, nextPropertyId);
}
```

- [ ] **Step 5: Controller.** No signature change needed (create already takes `@Body() dto`); confirm `propertyId`/`roleCode` flow through. Remove any `browserDeviceId` handling.

- [ ] **Step 6: Module.** In `devices.module.ts`, add `PropertiesModule` to `imports` (provides `ContainmentService`).

- [ ] **Step 7: Update device tests** — every device fixture now needs a `networkId` + `propertyId`; add a create-outside-charter case asserting `PROP_007`. Run `cd apps/api && npm run test:unit -- devices && npm run test:integration -- devices` → PASS.

- [ ] **Step 8:** `npx tsc --noEmit` → now PASS (build green again). Commit `feat(api): attach devices to network+property with containment enforcement`.

---

## Task 8: Rewrite the seed

**Files:** Modify `apps/api/prisma/seed.ts`.

- [ ] **Step 1:** Create a SITE→BUILDING→FLOOR tree, a network, charter the network to the SITE, then create devices placed on the FLOOR (all under the charter). Remove all `browserDeviceId`/`BROWSER_CLIENT` seed data. Each `seedDevices` call now stamps `networkId` + `propertyId`.
- [ ] **Step 2:** `cd apps/api && npx prisma migrate reset --force` → migrations + seed apply cleanly.
- [ ] **Step 3: Commit** `chore(api): seed site tree, charters, and placed devices`.

---

## Task 9: Wire `PropertiesModule`, full suite, docs

- [ ] **Step 1: Register** in `PropertiesModule`: providers `NetworkPropertyRepository`, `NetworkPropertyService`, `ContainmentService`; controller `NetworkPropertyController`; exports add `ContainmentService` and `NetworkPropertyRepository`.
- [ ] **Step 2:** Confirm `DevicesModule` imports `PropertiesModule` and that `PropertiesModule` does **not** import `DevicesModule` (no cycle).
- [ ] **Step 3: Full suite.** `cd apps/api && npm run test:unit && npm run test:integration && npm run test:e2e` → all green.
- [ ] **Step 4: Charter/containment e2e** — OWNER charters a network to a SITE, places a device on a FLOOR under it (200), attempts a device on an unrelated SITE (`PROP_007`), removes a charter still in use (`PROP_008`), adds a duplicate charter (`PROP_006`).
- [ ] **Step 5: Docs (Rule 10)** — `PROP_006`–`PROP_008` + charter events in the API Design Document; note the Device-as-junction + containment in the SAD.
- [ ] **Step 6: Commit** `feat(api): wire F2 charters/containment; docs + full suite green`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** `Device` re-attachment + `NOT NULL` networkId/propertyId + roleCode (§4.3) ✓ Tasks 1, 7; drop `Network.propertyId` (§4.4) ✓ Task 1; `BROWSER_CLIENT` retirement (§4.5) ✓ Task 1; `NetworkProperty` (§4.2) ✓ Tasks 1, 3, 5; containment on create/move (§6) ✓ Tasks 4, 7; charter removal (§6) ✓ Tasks 4, 5; reparent re-validation (§5/§6) ✓ Tasks 4, 6; delete-block on devices/charters (§5) ✓ Task 6; `onDelete` Restrict posture (§4.6) ✓ Task 1; DTOs/events/codes (§10) ✓ Task 2.
- **Type consistency:** `assertDevicePlacement(orgId, networkId, propertyId)`, `assertReparentKeepsContainment(orgId, movedId, newParentId)`, `assertCharterRemovable(orgId, networkId, propertyId)` used identically in service + tests; `propertyIdsByNetwork`, `getAncestorIds`, `getSubtreeIds`, `devicesUnder`, `countDevicesUnder`, `countChartersUnder` names align across repo/containment/service; `NetworkProperty` audit `entityType` is the string `'NetworkProperty'`.
- **No module cycle:** charters + containment live in `PropertiesModule`; `DevicesModule → PropertiesModule` only; `PropertiesModule` reaches `Device`/`NetworkProperty` rows via Prisma, never via `DevicesModule`.
- **Build sequencing:** Task 1 reddens the build (expected `tsc` FAIL committed); Tasks 6-8 restore it; Task 9 verifies the whole suite.
- **Integration points to verify during execution:** the `BROWSER_CLIENT`/`browserDeviceId` grep (precondition), `DEVICE_WRITABLE_FIELDS` location, the device `updateDevice` patch-changes shape (F1a), and `ConflictResolutionService`/`AuditService` signatures — each against the named existing file.
