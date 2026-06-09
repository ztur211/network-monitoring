# Spec 1 Phase C — Device 3D Coordinates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a device carry model-local `x/y/z`: a basic `PATCH /v1/devices/:id/position` that sets/clears the triple, validating the device resolves to a `BUILDING` with a model (`SPATIAL_001`) and that the triple is complete (`SPATIAL_002`); expose `x/y/z` on `DeviceDto`; and **clear `x/y/z` when a device is moved to a different building** (its coords were local to the prior model).

**Architecture:** A small `spatial` module owns the position concern end-to-end: `SpatialRepository` (load device, set/clear `x/y/z`, resolve a property's governing `BUILDING` via an upward CTE), `SpatialService` (the validation rules), `SpatialController` (`/v1/devices/:id/position`). The clear-on-move rule is a hook added to F2's `DevicesService.updateDevice`. Rich 3D authoring (snapping, drag) is **Spec 4** — this is just "the data can be set."

**Tech Stack:** NestJS 11, Prisma 5 (`$queryRaw` recursive CTE), Jest (unit + integration + e2e).

**Depends on:**
- **Spec 1 Phase A** — `Device.x/y/z`, `DevicePositionDto`, `BuildingModelsRepository.findByProperty`, `SPATIAL_*` codes.
- **F1a** — `Device.organizationId`, `@OrgMember()`/`@OrgRoles`, `NodeScopeException`, the device DTO mapper, `PrismaService`.
- **F2** — `Device.propertyId`, the `Property` tree (`BUILDING` type), `DevicesService.updateDevice` (where the move hook lands).
- Spec: `2026-06-09-spec1-spatial-foundation-design.md` (§6, §10.5).

---

## File Structure

**Create:**
- `apps/api/src/spatial/spatial.repository.ts` — device load/set-position + governing-building CTE
- `apps/api/src/spatial/spatial.service.ts` — position validation rules
- `apps/api/src/spatial/spatial.controller.ts` — `PATCH /v1/devices/:id/position`
- `apps/api/src/spatial/spatial.module.ts`
- `apps/api/src/spatial/__tests__/spatial.repository.spec.ts` (integration)
- `apps/api/src/spatial/__tests__/spatial.service.spec.ts` (unit)
- `apps/api/src/spatial/__tests__/spatial.e2e.ts` (e2e)

**Modify:**
- the F1a/F2 device DTO mapper (`toDeviceDto`) — include `x/y/z`
- `apps/api/src/devices/devices.service.ts` (F2) — clear `x/y/z` on building change
- `apps/api/src/app.module.ts` — import `SpatialModule`

---

## Task 1: `SpatialRepository` (integration TDD)

**Files:** Create `spatial.repository.ts`; test `__tests__/spatial.repository.spec.ts`.

- [ ] **Step 1: Write the failing integration test**

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { SpatialRepository } from '../spatial.repository';

describe('SpatialRepository (integration)', () => {
  let repo: SpatialRepository; let prisma: PrismaService; let orgId: string;
  beforeAll(async () => {
    const ref = await Test.createTestingModule({ providers: [SpatialRepository, PrismaService] }).compile();
    repo = ref.get(SpatialRepository); prisma = ref.get(PrismaService); await prisma.$connect();
  });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: `SP${Date.now()}${Math.round(performance.now())}` } });
    orgId = org.id;
  });
  afterEach(async () => { await prisma.organization.delete({ where: { id: orgId } }); });

  it('resolves the nearest BUILDING ancestor of a property; null when none', async () => {
    const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'S' } });
    const bld = await prisma.property.create({ data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'B' } });
    const flr = await prisma.property.create({ data: { organizationId: orgId, parentId: bld.id, type: 'FLOOR', name: '1' } });
    expect(await repo.resolveGoverningBuildingId(orgId, flr.id)).toBe(bld.id);
    expect(await repo.resolveGoverningBuildingId(orgId, bld.id)).toBe(bld.id); // self
    expect(await repo.resolveGoverningBuildingId(orgId, site.id)).toBeNull(); // no building above a SITE
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:integration -- spatial`.

- [ ] **Step 3: Implement `spatial.repository.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { Device } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SpatialRepository {
  constructor(private readonly prisma: PrismaService) {}

  findDevice(organizationId: string, deviceId: string): Promise<Device | null> {
    return this.prisma.device.findFirst({ where: { id: deviceId, organizationId } });
  }

  /** Nearest BUILDING ancestor-or-self of `propertyId`, or null if none up the chain. */
  async resolveGoverningBuildingId(organizationId: string, propertyId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE chain AS (
        SELECT "id", "parentId", "type", 0 AS depth FROM "Property"
          WHERE "id" = ${propertyId} AND "organizationId" = ${organizationId}
        UNION ALL
        SELECT p."id", p."parentId", p."type", c.depth + 1 FROM "Property" p
          JOIN chain c ON p."id" = c."parentId" AND p."organizationId" = ${organizationId}
      )
      SELECT "id" FROM chain WHERE "type" = 'BUILDING' ORDER BY depth ASC LIMIT 1;
    `;
    return rows[0]?.id ?? null;
  }

  async setPosition(organizationId: string, deviceId: string, x: number | null, y: number | null, z: number | null): Promise<Device> {
    await this.prisma.device.updateMany({ where: { id: deviceId, organizationId }, data: { x, y, z, version: { increment: 1 } } });
    return this.prisma.device.findFirstOrThrow({ where: { id: deviceId, organizationId } });
  }
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): SpatialRepository (governing-building CTE + device position)`.

---

## Task 2: `SpatialService` — position rules (unit TDD)

**Files:** Create `spatial.service.ts`; test `__tests__/spatial.service.spec.ts`.

- [ ] **Step 1: Write the failing unit test**

```typescript
import { Test } from '@nestjs/testing';
import { SpatialService } from '../spatial.service';
import { SpatialRepository } from '../spatial.repository';
import { BuildingModelsRepository } from '../../building-models/building-models.repository';
import { OrganizationMember } from '@prisma/client';

const owner = { id: 'o', organizationId: 'org', role: 'OWNER' } as OrganizationMember;

describe('SpatialService.setPosition (unit)', () => {
  let service: SpatialService;
  const repo = { findDevice: jest.fn(), resolveGoverningBuildingId: jest.fn(), setPosition: jest.fn() } as any;
  const models = { findByProperty: jest.fn() } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const ref = await Test.createTestingModule({
      providers: [SpatialService, { provide: SpatialRepository, useValue: repo }, { provide: BuildingModelsRepository, useValue: models }],
    }).compile();
    service = ref.get(SpatialService);
    repo.findDevice.mockResolvedValue({ id: 'd', organizationId: 'org', propertyId: 'p', version: 1 });
  });

  it('rejects an incomplete triple with SPATIAL_002', async () => {
    await expect(service.setPosition(owner, 'd', { x: 1, y: 2, z: null })).rejects.toMatchObject({ code: 'SPATIAL_002' });
  });

  it('rejects when the device is not under a modeled building (SPATIAL_001)', async () => {
    repo.resolveGoverningBuildingId.mockResolvedValue('b1');
    models.findByProperty.mockResolvedValue(null); // building has no model
    await expect(service.setPosition(owner, 'd', { x: 1, y: 2, z: 3 })).rejects.toMatchObject({ code: 'SPATIAL_001' });
  });

  it('sets a complete triple when building+model resolve', async () => {
    repo.resolveGoverningBuildingId.mockResolvedValue('b1');
    models.findByProperty.mockResolvedValue({ id: 'm' });
    repo.setPosition.mockResolvedValue({ id: 'd', x: 1, y: 2, z: 3 });
    await service.setPosition(owner, 'd', { x: 1, y: 2, z: 3 });
    expect(repo.setPosition).toHaveBeenCalledWith('org', 'd', 1, 2, 3);
  });

  it('clearing (all null) is always allowed without a building check', async () => {
    repo.setPosition.mockResolvedValue({ id: 'd', x: null, y: null, z: null });
    await service.setPosition(owner, 'd', { x: null, y: null, z: null });
    expect(repo.resolveGoverningBuildingId).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:unit -- spatial.service`.

- [ ] **Step 3: Implement `spatial.service.ts`**

```typescript
import { HttpStatus, Injectable } from '@nestjs/common';
import { OrganizationMember } from '@prisma/client';
import { DevicePositionDto } from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { SpatialRepository } from './spatial.repository';
import { BuildingModelsRepository } from '../building-models/building-models.repository';
import { toDeviceDto } from '../devices/device.mapper';

@Injectable()
export class SpatialService {
  constructor(
    private readonly repo: SpatialRepository,
    private readonly models: BuildingModelsRepository,
  ) {}

  async setPosition(member: OrganizationMember, deviceId: string, pos: DevicePositionDto) {
    const device = await this.repo.findDevice(member.organizationId, deviceId);
    if (!device) throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const allNull = pos.x == null && pos.y == null && pos.z == null;
    const allSet = pos.x != null && pos.y != null && pos.z != null;
    if (!allNull && !allSet) throw new NodeScopeException('SPATIAL_002', 'INCOMPLETE_POSITION', HttpStatus.UNPROCESSABLE_ENTITY);

    if (allSet) {
      const buildingId = await this.repo.resolveGoverningBuildingId(member.organizationId, device.propertyId);
      const model = buildingId ? await this.models.findByProperty(member.organizationId, buildingId) : null;
      if (!model) throw new NodeScopeException('SPATIAL_001', 'DEVICE_NOT_IN_MODELED_BUILDING', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const updated = await this.repo.setPosition(member.organizationId, deviceId, pos.x, pos.y, pos.z);
    return toDeviceDto(updated);
  }
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): SpatialService device-position rules (SPATIAL_001/002)`.

---

## Task 3: Controller + DTO mapper + e2e

**Files:** Create `spatial.controller.ts`, `spatial.module.ts`; modify the device DTO mapper + `app.module.ts`; test `__tests__/spatial.e2e.ts`.

- [ ] **Step 1: Expose `x/y/z` on `DeviceDto`.** In the F1a/F2 device mapper (`devices/device.mapper.ts` or wherever `toDeviceDto` lives), add `x: device.x, y: device.y, z: device.z` to the returned object. (The DTO type gained the fields in Phase A.)

- [ ] **Step 2: Controller**

```typescript
@Controller('v1/devices')
export class SpatialController {
  constructor(private readonly service: SpatialService) {}

  @Patch(':id/position')
  @OrgRoles('OWNER', 'ADMIN')
  async setPosition(
    @OrgMember() member: OrganizationMember,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DevicePositionInputDto,
  ) {
    const data = await this.service.setPosition(member, id, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
```

`DevicePositionInputDto` (in `spatial.dto.ts`) validates an optional-but-coherent triple:
```typescript
import { IsNumber, IsOptional } from 'class-validator';
export class DevicePositionInputDto {
  @IsOptional() @IsNumber() x!: number | null;
  @IsOptional() @IsNumber() y!: number | null;
  @IsOptional() @IsNumber() z!: number | null;
}
```

- [ ] **Step 3: `spatial.module.ts`** — imports `PrismaModule`, `BuildingModelsModule` (for `BuildingModelsRepository`); declares `SpatialController`, providers `SpatialService`, `SpatialRepository`; exports `SpatialRepository` (the device-move hook in Task 4 uses it). Add `SpatialModule` to `AppModule.imports`.

- [ ] **Step 4: Write the e2e** (`spatial.e2e.ts`) — seed org + OWNER; `SITE`→`BUILDING`→`FLOOR`; a device on the `FLOOR`; upload a model to the `BUILDING` (reuse Phase B's upload); then:

```typescript
it('sets a position on a device in a modeled building; clears it; rejects partial + unmodeled', async () => {
  await request(server).patch(`/api/v1/devices/${deviceId}/position`).set('Cookie', ownerCookie)
    .send({ x: 1.5, y: 2, z: 3 }).expect(200)
    .expect((r) => expect(r.body.data).toMatchObject({ x: 1.5, y: 2, z: 3 }));
  await request(server).patch(`/api/v1/devices/${deviceId}/position`).set('Cookie', ownerCookie)
    .send({ x: null, y: null, z: null }).expect(200);
  const partial = await request(server).patch(`/api/v1/devices/${deviceId}/position`).set('Cookie', ownerCookie)
    .send({ x: 1, y: 2, z: null }).expect(422);
  expect(partial.body.error.code).toBe('SPATIAL_002');
  // device on a SITE (no building) → SPATIAL_001
  const sp = await request(server).patch(`/api/v1/devices/${deviceOnSiteId}/position`).set('Cookie', ownerCookie)
    .send({ x: 1, y: 2, z: 3 }).expect(422);
  expect(sp.body.error.code).toBe('SPATIAL_001');
});

it('MEMBER cannot set a position (ORG_003)', async () => {
  await request(server).patch(`/api/v1/devices/${deviceId}/position`).set('Cookie', memberCookie)
    .send({ x: 1, y: 2, z: 3 }).expect(403);
});
```

- [ ] **Step 5: Run → PASS.** Commit `feat(api): PATCH /v1/devices/:id/position (basic 3D placement)`.

---

## Task 4: Clear `x/y/z` on building change (hook F2 `DevicesService`)

**Files:** Modify `apps/api/src/devices/devices.service.ts` (F2).

When a device's `propertyId` changes and its governing `BUILDING` differs from before, its model-local coordinates no longer mean anything — clear them (spec §6).

- [ ] **Step 1: Write the failing e2e** (extend `spatial.e2e.ts` or the device e2e): a device placed at `x/y/z` in building B1, moved (via the F2 device update / `propertyId` change) to a property under building B2, comes back with `x/y/z = null`; moved between FLOORs **within** B1, keeps its coords.

```typescript
it('clears x/y/z when a device moves to a different building; keeps them within the same building', async () => {
  // device in B1 floor, positioned; move to B2 floor:
  await request(server).patch(`/api/v1/devices/${deviceId}`).set('Cookie', ownerCookie)
    .send({ baseVersion: v, changes: [{ field: 'propertyId', value: b2FloorId }] }).expect(200);
  const moved = await request(server).get(`/api/v1/devices/${deviceId}`).set('Cookie', ownerCookie).expect(200);
  expect(moved.body.data).toMatchObject({ x: null, y: null, z: null });
});
```

- [ ] **Step 2: Implement the hook** in `DevicesService.updateDevice` — after F2's containment-validated `propertyId` change, compare governing buildings and clear if different. Inject `SpatialRepository`:

```typescript
// inside updateDevice, when the patch changes propertyId:
if (newPropertyId && newPropertyId !== existing.propertyId) {
  const [oldB, newB] = await Promise.all([
    this.spatial.resolveGoverningBuildingId(member.organizationId, existing.propertyId),
    this.spatial.resolveGoverningBuildingId(member.organizationId, newPropertyId),
  ]);
  if (oldB !== newB) {
    patchData.x = null; patchData.y = null; patchData.z = null; // fold into the same update
  }
}
```

Inject `SpatialRepository` into `DevicesService` (import `SpatialModule`; if it creates a `DevicesModule` ↔ `SpatialModule` cycle, use `forwardRef`, or expose `resolveGoverningBuildingId` via a tiny shared provider).

- [ ] **Step 3: Run → PASS.** `cd apps/api && npm run test:e2e -- spatial`. Commit `feat(api): clear device x/y/z when its governing building changes`.

---

## Task 5: Phase gate

- [ ] **Step 1: Full suite** (infra up): `docker compose -f docker-compose.test.yml up -d`, then `cd apps/api && npm run test:unit && npm run test:integration && npm run test:e2e` → green.
- [ ] **Step 2: Seed (spec §9).** Extend `apps/api/prisma/seed.ts`: create a sample `BuildingModel` on a seeded `BUILDING` — put a tiny valid IFC (`ISO-10303-21;…`) via the S3 client under a `storageKey`, create the `BuildingModelVersion`, set it active — and give one seeded device a sample `x/y/z`. Run `cd apps/api && npx prisma db seed` (MinIO up) → succeeds.
- [ ] **Step 3: Docs (Rule 10).** Register `PATCH /v1/devices/:id/position` + `SPATIAL_001/002` in the API Design Document; note `DeviceDto` now carries `x/y/z` and the clear-on-building-change rule in the SAD.
- [ ] **Step 4: Commit** `docs: Spec 1 device 3D coordinates + seed (Phase C)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** model-local `x/y/z` set/clear via a basic endpoint (§6, §10.5) ✓ Tasks 2–3; building resolution via F2 `propertyId` → `BUILDING` ancestor (§6) ✓ Task 1; only-in-modeled-building/`SPATIAL_001`, complete-triple/`SPATIAL_002`, clear-always-allowed (§6) ✓ Task 2; clear-on-building-change (§6) ✓ Task 4; `DeviceDto` gains `x/y/z` (§10.1) ✓ Task 3; OWNER/ADMIN + `ORG_003` (§8) ✓ Task 3.
- **Boundary respected:** only a *basic* set/clear endpoint — rich 3D authoring (snapping, drag, version-aware placement) stays Spec 4. ✓
- **Placeholder scan:** none — concrete code/commands throughout.
- **Type consistency:** `SpatialRepository` (`findDevice`/`resolveGoverningBuildingId`/`setPosition`) consumed verbatim by `SpatialService` and the Task 4 hook; `DevicePositionDto` (Phase A) ↔ `DevicePositionInputDto` (request) ↔ `setPosition(member, id, pos)`; `BuildingModelsRepository.findByProperty` reused from Phase A; coords increment `Device.version`.
- **Test-config compliance:** `spatial.repository.spec.ts` (integration), `spatial.service.spec.ts` (unit), `spatial.e2e.ts` (e2e).
- **Integration points to verify during execution:** F1a `Device.organizationId` + the device DTO mapper location/name; F2 `DevicesService.updateDevice` patch-handling shape (how `propertyId` changes are represented in the changeset) for the Task 4 hook; the `DevicesModule` ↔ `SpatialModule` cycle (`forwardRef`); `Device.version` increment interplay with F2's optimistic concurrency on the same row.
