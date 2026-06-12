# Spec 5 Phase B — Export Service & Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed the Phase-A writer real data: `ExportService` gathers a building's **in-scope placed devices** (+ network names) and builds the IFC; `ExportController` streams it from `GET /v1/buildings/:propertyId/export/ifc` (F3-scoped, MEMBER-allowed, file download).

**Architecture:** `ExportService` validates the `propertyId` is an in-scope `BUILDING`, resolves the F2 subtree ∩ F3 `scopeFilter`, queries placed devices (`x/y/z` not null) with their `Network` name, maps to `ExportDevice[]`, and calls `buildNetworkIfc`. `ExportController` uses `@Res()` to send the raw `.ifc` (bypassing the JSON envelope) with download headers.

**Tech Stack:** NestJS 11, Prisma, Jest (integration + e2e).

**Depends on:**
- **Phase A** — `buildNetworkIfc`, `ExportDevice`.
- **Spec 1** — `Device.x/y/z`; the `BUILDING` `Property`.
- **F2/F3** — `PropertiesService.subtreePropertyIds`, `PermissionsService` (`inScope`, `scopeFilter`), `Network`.
- **F1a** — `@OrgId`/`@CurrentMember`, `NodeScopeException`.
- Spec: `2026-06-12-spec5-ifc-export-design.md` (§6, §7, §9).

---

## File Structure

**Create:**
- `apps/api/src/export/export.service.ts`, `export.controller.ts`, `export.module.ts`
- tests `apps/api/src/export/__tests__/{export.service.spec.ts, export.controller.e2e.ts}`

---

## Task 1: `ExportService` (Jest integration)

**Files:** Create `export.service.ts`; test `export/__tests__/export.service.spec.ts`.

- [ ] **Step 1: Failing integration test** — only in-scope placed devices are exported; an unknown building → 404:
```typescript
it('exports only in-scope placed devices of the building', async () => {
  // building → floor; placed device on the floor; an unplaced device; (scope = whole org for an OWNER member)
  const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'S' } });
  const bld = await prisma.property.create({ data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'HQ' } });
  const floor = await prisma.property.create({ data: { organizationId: orgId, parentId: bld.id, type: 'FLOOR', name: 'F1' } });
  const net = await prisma.network.create({ data: { organizationId: orgId, name: 'Core' } });
  await prisma.device.create({ data: { organizationId: orgId, name: 'SW1', category: 'SWITCH', propertyId: floor.id, networkId: net.id, x: 1, y: 2, z: 3, ipAddress: '10.0.0.5' } });
  await prisma.device.create({ data: { organizationId: orgId, name: 'Unplaced', category: 'SWITCH', propertyId: floor.id, networkId: net.id } }); // no x/y/z

  const { filename, ifc } = await svc.getBuildingExport(orgId, owner, bld.id);
  expect(filename).toBe('HQ-network.ifc');
  expect((ifc.match(/IFCBUILDINGELEMENTPROXY/g) ?? [])).toHaveLength(1); // only the placed one
  expect(ifc).toContain('IFCCARTESIANPOINT((1.000000,2.000000,3.000000))');
  await expect(svc.getBuildingExport(orgId, owner, 'no-such-id')).rejects.toMatchObject({ status: 404 });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:integration -- export.service`.

- [ ] **Step 3: Implement `export.service.ts`:**
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PropertiesService } from '../properties/properties.service'; // F2
import { PermissionsService } from '../permissions/permissions.service'; // F3
import { NodeScopeException } from '../common/errors/nodescope.exception';
import { buildNetworkIfc, ExportDevice } from './ifc2x3-writer';
import type { Member } from '../common/types';

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService, private readonly properties: PropertiesService, private readonly permissions: PermissionsService) {}

  async getBuildingExport(orgId: string, member: Member, buildingPropertyId: string): Promise<{ filename: string; ifc: string }> {
    const building = await this.prisma.property.findFirst({ where: { id: buildingPropertyId, organizationId: orgId, type: 'BUILDING' } });
    if (!building || (member.role !== 'OWNER' && !(await this.permissions.inScope(member.id, buildingPropertyId)))) {
      throw new NodeScopeException('PROP_001', 'Building not found', 404); // invisible-not-forbidden (F3)
    }
    const subtree = await this.properties.subtreePropertyIds(orgId, buildingPropertyId);
    const scope = member.role === 'OWNER' ? null : (await this.permissions.scopeFilter(member.id)).propertyIdIn;
    const propertyIdIn = scope ? subtree.filter((id) => scope.includes(id)) : subtree;
    const rows = propertyIdIn.length
      ? await this.prisma.device.findMany({
          where: { organizationId: orgId, propertyId: { in: propertyIdIn }, x: { not: null }, y: { not: null }, z: { not: null } },
          include: { network: { select: { name: true } } },
        })
      : [];
    const devices: ExportDevice[] = rows.map((d) => ({ id: d.id, name: d.name, category: d.category as string, x: d.x!, y: d.y!, z: d.z!, ipAddress: d.ipAddress, macAddress: d.macAddress, networkName: d.network?.name ?? null }));
    const ifc = buildNetworkIfc({ building: { id: building.id, name: building.name }, storeyName: 'Network', devices, timestamp: new Date().toISOString() });
    return { filename: `${building.name.replace(/[^\w.-]+/g, '_')}-network.ifc`, ifc };
  }
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): ExportService (in-scope placed devices → IFC)`.

---

## Task 2: `ExportController` + module (Jest e2e)

**Files:** Create `export.controller.ts`, `export.module.ts`; test `export/__tests__/export.controller.e2e.ts`.

- [ ] **Step 1: Failing e2e:**
```typescript
it('streams a downloadable .ifc; out-of-scope → 404; MEMBER may export', async () => {
  const res = await request(srv).get(`/v1/buildings/${buildingId}/export/ifc`).set(ownerAuth).expect(200);
  expect(res.headers['content-type']).toContain('application/x-step');
  expect(res.headers['content-disposition']).toContain('attachment; filename="HQ-network.ifc"');
  expect(res.text.startsWith('ISO-10303-21;')).toBe(true);
  expect(res.text).toContain('IFCBUILDINGELEMENTPROXY');
  await request(srv).get(`/v1/buildings/${buildingId}/export/ifc`).set(memberInScopeAuth).expect(200); // member may export
  await request(srv).get(`/v1/buildings/${outOfScopeBuildingId}/export/ifc`).set(memberOutOfScopeAuth).expect(404);
});
```

- [ ] **Step 2: Run → FAIL**, then implement `export.controller.ts`:
```typescript
import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { OrgId } from '../common/decorators/org-id.decorator';
import { CurrentMember } from '../common/decorators/current-member.decorator';
import type { Member } from '../common/types';
import { ExportService } from './export.service';

@Controller('v1/buildings')
export class ExportController {
  constructor(private readonly svc: ExportService) {}

  @Get(':propertyId/export/ifc')
  async exportIfc(@OrgId() orgId: string, @CurrentMember() member: Member, @Param('propertyId') propertyId: string, @Res() res: Response): Promise<void> {
    const { filename, ifc } = await this.svc.getBuildingExport(orgId, member, propertyId);
    res.setHeader('Content-Type', 'application/x-step');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(ifc); // @Res() → raw file, bypasses the JSON envelope interceptor
  }
}
```
`export.module.ts` provides `ExportService`, registers `ExportController`, imports `PropertiesModule` (F2) + `PermissionsModule` (F3) + `PrismaModule`. Wire `ExportModule` into the app module.

- [ ] **Step 3: Run → PASS.** Commit `feat(api): GET /v1/buildings/:id/export/ifc (F3-scoped IFC download)`.

---

## Task 3: Phase gate

- [ ] **Step 1: Suites.** `cd apps/api && npm run test:integration -- export.service && npm run test:e2e -- export.controller` → green.
- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` → PASS.
- [ ] **Step 3: Manual end-to-end:** with a building that has placed devices, `curl -o hq.ifc -H "<auth>" …/v1/buildings/<id>/export/ifc` → open `hq.ifc` in an IFC viewer / federate against the architectural model → the nodes appear at their positions with `Pset_NodeScope`.
- [ ] **Step 4: Docs (Rule 10).** API Design Document: `GET /v1/buildings/:propertyId/export/ifc` (response `application/x-step`, scope, filename). A `docs/product-knowledge` note on federating `*-network.ifc`. SAD/CLAUDE.md: the IFC export module.
- [ ] **Step 5: Commit** `docs: record Spec 5 export service + endpoint (Phase B) + IFC export complete`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** in-scope placed-device gather (§6, §7) ✓ Task 1; building validation → 404, invisible-not-forbidden (§7) ✓ Task 1; F3 `scopeFilter` (no out-of-scope leak) (§7, §9) ✓ Task 1; streaming `application/x-step` + `Content-Disposition` (§7) ✓ Task 2; MEMBER may export (§7) ✓ Task 2; filename from building name (sanitized) (§7) ✓ Task 1.
- **Deferred (correctly per spec):** per-floor storeys, stored/versioned exports, IFC4, per-category geometry, site-offset, unplaced summary (spec §12).
- **Placeholder scan:** none — concrete code/commands.
- **Type consistency:** `ExportDevice` (Phase A) ↔ the service's map (`d.x!/y!/z!`, `network.name`); `buildNetworkIfc` input; `getBuildingExport → { filename, ifc }` ↔ the controller; `PropertiesService.subtreePropertyIds`/`PermissionsService.inScope`+`scopeFilter` (F2/F3); `@Res()` bypasses the envelope.
- **Test-config compliance:** service integration (test DB, OWNER member); controller e2e (OWNER + in-/out-of-scope MEMBER auth helpers + the raw-text assertion). No JSON-envelope expectation on the file route.
- **Integration points to verify during execution:** F2 `subtreePropertyIds` + F3 `inScope`/`scopeFilter` signatures; the app's HTTP adapter for `@Res()` (Express assumed); the actual F2 not-found code (`PROP_001` here) + `Member` type; that the global response interceptor skips `@Res()` handlers (so the `.ifc` isn't wrapped).
