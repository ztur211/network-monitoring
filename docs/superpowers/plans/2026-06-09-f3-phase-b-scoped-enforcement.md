# F3 Phase B — Scoped Enforcement on Reads & Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace F2's interim coarse posture (MEMBER read-only / OWNER+ADMIN mutate org-wide) with the F3 spec §5/§6 scoped decision. Every site-bound **read** is filtered to the caller's assigned subtrees (out-of-scope rows are invisible → 404 on direct get); every **write** runs `assertCanConfigure(member, governingSiteId)`. Networks get the shared-network scoped view; connections/fiber-runs/circuits get the inter-site-link rule.

**Architecture:** Thread the active `OrganizationMember` and the Phase-A `PermissionsService` into the F1a/F2 entity services. Reads `AND` `scopeFilter(member)` into the repository `where`; writes resolve the entity's governing site and call `assertCanConfigure`. `Device` is the template (governing site = `propertyId`); `Property` governs by itself (so top-level-site creation is OWNER-only by construction); `Network` and the three link types use the §6 special rules. The repository layer stays the single chokepoint.

**Tech Stack:** NestJS 11, Prisma 5, Jest (unit + e2e on test DB `:5433`). No schema change.

**Depends on:**
- **F3 Phase A** — `PermissionsService` (`assertCanConfigure`, `scopeFilter`, `scopePropertyIds`, `inScope`), `PermissionsModule` (exported), `PERM_001`.
- **F1a** — `OrganizationMember` + `role`, `@OrgId()`, `OrgContextGuard` (global; populates `request.orgMember`), `ORG_003`, the entity controllers/services/repositories, `NodeScopeException`.
- **F2** — `PropertiesService` (`governingSiteId`/`subtreePropertyIds`/`isAtOrUnder`), `Device.propertyId`, `NetworkProperty`, the entity controllers gated `@OrgRoles('OWNER','ADMIN')`.
- Spec: `2026-06-09-f3-team-site-verb-permissions-design.md` (§5 decision, §6 enforcement incl. shared-network + inter-site-link, §11).

> **Replaces, not adds.** F2 Phase D's blanket `@OrgRoles('OWNER','ADMIN')` mutation gate is **superseded** here by the per-entity scoped check (Task 5 removes the now-redundant gate). The global `OrgRoleGuard` stays for purely role-gated, non-site endpoints (e.g. F3 Phase C role management).

---

## File Structure

**Create:**
- `apps/api/src/organizations/decorators/org-member.decorator.ts` — `@OrgMember()` param decorator returning `request.orgMember` (only if F1a doesn't already expose one).

**Modify (F1a/F2-created files):**
- `apps/api/src/devices/{devices.controller,devices.service,devices.repository}.ts` (+ e2e)
- `apps/api/src/properties/{properties.controller,properties.service}.ts` (+ e2e)
- `apps/api/src/networks/{networks.controller,networks.service,networks.repository}.ts` (+ e2e)
- `apps/api/src/connections/{connections.controller,connections.service}.ts` (+ e2e)
- `apps/api/src/fiber-runs/{fiber-runs.controller,fiber-runs.service}.ts` (+ e2e)
- `apps/api/src/circuits/{circuits.controller,circuits.service}.ts` (+ e2e)
- Each module imports `PermissionsModule`.

---

## Task 1: `@OrgMember()` + Devices scoped reads & writes (the template)

**Files:** Create `org-member.decorator.ts`; modify `devices.{controller,service,repository}.ts`; extend `devices.controller.e2e.ts`.

- [ ] **Step 1: Add the `@OrgMember()` decorator** (skip if F1a already exposes one — confirm first)

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { OrganizationMember } from '@prisma/client';

// request.orgMember is populated by F1a's global OrgContextGuard.
export const OrgMember = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrganizationMember =>
    ctx.switchToHttp().getRequest().orgMember as OrganizationMember,
);
```

- [ ] **Step 2: Write the failing e2e** in `devices.controller.e2e.ts` (seed org; OWNER + ADMIN + MEMBER memberships; two SITEs `sA`,`sB`; a network chartered to both; a device under `sA` and one under `sB`; ADMIN assigned only `sA` via a team):

```typescript
it('MEMBER assigned sA sees only sA devices; sB device is 404', async () => {
  currentUser = memberUser; // member assigned team→sA
  const list = await request(server).get('/api/v1/devices').set('Cookie', memberCookie).expect(200);
  const ids = list.body.data.items.map((d: any) => d.id);
  expect(ids).toContain(deviceUnderA.id);
  expect(ids).not.toContain(deviceUnderB.id);
  await request(server).get(`/api/v1/devices/${deviceUnderB.id}`).set('Cookie', memberCookie).expect(404);
});

it('ADMIN assigned sA may configure sA device, not sB device (PERM_001); MEMBER cannot mutate (ORG_003)', async () => {
  // ADMIN edits device under sA → 200
  await request(server).patch(`/api/v1/devices/${deviceUnderA.id}`).set('Cookie', adminCookie)
    .send({ baseVersion: deviceUnderA.version, changes: [{ field: 'name', value: 'edited' }] }).expect(200);
  // ADMIN edits device under sB → 403 PERM_001
  const denied = await request(server).patch(`/api/v1/devices/${deviceUnderB.id}`).set('Cookie', adminCookie)
    .send({ baseVersion: deviceUnderB.version, changes: [{ field: 'name', value: 'x' }] }).expect(403);
  expect(denied.body.error.code).toBe('PERM_001');
  // MEMBER mutate → 403 ORG_003
  const m = await request(server).patch(`/api/v1/devices/${deviceUnderA.id}`).set('Cookie', memberCookie)
    .send({ baseVersion: deviceUnderA.version, changes: [{ field: 'name', value: 'y' }] }).expect(403);
  expect(m.body.error.code).toBe('ORG_003');
});

it('OWNER sees and configures both', async () => {
  const list = await request(server).get('/api/v1/devices').set('Cookie', ownerCookie).expect(200);
  expect(list.body.data.items.map((d: any) => d.id)).toEqual(expect.arrayContaining([deviceUnderA.id, deviceUnderB.id]));
});
```

- [ ] **Step 3: Run → FAIL** (`cd apps/api && npm run test:e2e -- devices`) — today every member sees all and the coarse gate lets any ADMIN mutate any site.

- [ ] **Step 4: Repository — accept a scope filter on reads.** In `devices.repository.ts`, add the optional `propertyId IN` filter:

```typescript
async listForOrg(
  organizationId: string,
  scope: { propertyIdIn: string[] } | null,
): Promise<Device[]> {
  return this.prisma.device.findMany({
    where: { organizationId, ...(scope && { propertyId: { in: scope.propertyIdIn } }) },
    orderBy: { createdAt: 'asc' },
  });
}

async findInScope(
  organizationId: string,
  deviceId: string,
  scope: { propertyIdIn: string[] } | null,
): Promise<Device | null> {
  return this.prisma.device.findFirst({
    where: { id: deviceId, organizationId, ...(scope && { propertyId: { in: scope.propertyIdIn } }) },
  });
}
```

- [ ] **Step 5: Service — apply scope on reads, `assertCanConfigure` on writes.** In `devices.service.ts`, inject `PermissionsService`, and thread `member`:

```typescript
async listDevices(member: OrganizationMember): Promise<DeviceDto[]> {
  const scope = await this.permissions.scopeFilter(member);
  const devices = await this.repo.listForOrg(member.organizationId, scope);
  return devices.map(toDeviceDto);
}

async getDevice(member: OrganizationMember, deviceId: string): Promise<DeviceDto> {
  const scope = await this.permissions.scopeFilter(member);
  const device = await this.repo.findInScope(member.organizationId, deviceId, scope);
  if (!device) throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
  return toDeviceDto(device);
}

async createDevice(member: OrganizationMember, dto: CreateDeviceDto): Promise<DeviceDto> {
  await this.permissions.assertCanConfigure(member, dto.propertyId); // governing site = target site
  // ... existing F2 create (containment check, naming) unchanged ...
}

async updateDevice(member: OrganizationMember, deviceId: string, patch: PatchDeviceDto): Promise<DeviceDto> {
  const existing = await this.repo.findInScope(member.organizationId, deviceId, await this.permissions.scopeFilter(member));
  if (!existing) throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
  await this.permissions.assertCanConfigure(member, existing.propertyId); // current site
  const targetPropertyId = pendingPropertyIdFromPatch(patch) ?? existing.propertyId;
  if (targetPropertyId !== existing.propertyId) {
    await this.permissions.assertCanConfigure(member, targetPropertyId); // move: target site too (spec §6)
  }
  // ... existing F2 update (containment re-check, version) unchanged ...
}

async deleteDevice(member: OrganizationMember, deviceId: string): Promise<void> {
  const existing = await this.repo.findInScope(member.organizationId, deviceId, await this.permissions.scopeFilter(member));
  if (!existing) throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
  await this.permissions.assertCanConfigure(member, existing.propertyId);
  // ... existing delete ...
}
```

(`pendingPropertyIdFromPatch` reads a `propertyId` change out of the `ChangesetChangeDto[]`; return `undefined` if none.)

- [ ] **Step 6: Controller — pass `@OrgMember()`, drop the coarse role gate.** In `devices.controller.ts`, replace `@OrgRoles('OWNER','ADMIN')` on mutations with nothing (scoping now lives in the service) and pass the member:

```typescript
@Get()
async listDevices(@OrgMember() member: OrganizationMember) {
  const data = await this.devicesService.listDevices(member);
  return { success: true, data, timestamp: new Date().toISOString() };
}

@Post()
@HttpCode(HttpStatus.CREATED)
async createDevice(@OrgMember() member: OrganizationMember, @Body() dto: CreateDeviceDto) {
  const data = await this.devicesService.createDevice(member, dto);
  return { success: true, data, timestamp: new Date().toISOString() };
}
// PATCH/DELETE/GET(:id) likewise pass `member`; remove @OrgRoles from mutations.
```

Import `PermissionsModule` in `devices.module.ts`.

- [ ] **Step 7: Run → PASS** (`cd apps/api && npm run test:e2e -- devices`). Also update `devices.service.spec.ts` mocks to inject a mock `PermissionsService`; `npm run test:unit -- devices.service` → PASS.

- [ ] **Step 8: Commit** `feat(api): site-scoped device reads + writes (F3 §5/§6); drop coarse gate`.

---

## Task 2: Properties scoped reads & writes

**Files:** Modify `properties.{controller,service}.ts`; extend `properties.e2e-spec`/`properties.e2e.ts`.

Governing site of a `Property` is **itself** (spec §5): you may see/configure a node iff it is at/under one of your roots. Creating a child under an in-scope node is in scope; creating a **root** (`parentId = null`) is under no assigned root, so it is OWNER-only **by construction** — no special case needed beyond running the decision against the node's position.

- [ ] **Step 1: Write the failing e2e**

```typescript
it('ADMIN assigned sA: lists sA subtree only; creates a sub-site under sA; cannot create a top-level SITE', async () => {
  // GET filtered to sA subtree
  const list = await request(server).get('/api/v1/properties').set('Cookie', adminCookie).expect(200);
  const ids = list.body.data.map((p: any) => p.id);
  expect(ids).toContain(sA.id);
  expect(ids).not.toContain(sB.id);
  // sub-site (BUILDING under sA) → 201
  await request(server).post('/api/v1/properties').set('Cookie', adminCookie)
    .send({ parentId: sA.id, type: 'BUILDING', name: 'Bldg-1' }).expect(201);
  // top-level SITE (parentId null) → 403 PERM_001 (only OWNER)
  const denied = await request(server).post('/api/v1/properties').set('Cookie', adminCookie)
    .send({ parentId: null, type: 'SITE', name: 'New Campus' }).expect(403);
  expect(denied.body.error.code).toBe('PERM_001');
});

it('OWNER creates a top-level SITE', async () => {
  await request(server).post('/api/v1/properties').set('Cookie', ownerCookie)
    .send({ parentId: null, type: 'SITE', name: 'New Campus' }).expect(201);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement in `properties.service.ts`** — scope reads + a `assertCanConfigureProperty` that handles root-vs-child:

```typescript
async listProperties(member: OrganizationMember): Promise<PropertyDto[]> {
  const scope = await this.permissions.scopeFilter(member);
  const rows = await this.repo.listForOrg(member.organizationId, scope); // add propertyId-IN filter on `id`
  return rows.map(toPropertyDto);
}

async createProperty(member: OrganizationMember, dto: CreatePropertyDto): Promise<PropertyDto> {
  if (dto.parentId === null) {
    // top-level SITE: governed by a non-existent root ⇒ only OWNER. Reuse assertCanConfigure with a
    // sentinel that is in nobody's subtree, so OWNER passes and ADMIN/MEMBER fail (PERM_001/ORG_003).
    await this.permissions.assertCanConfigure(member, '__root__');
  } else {
    await this.permissions.assertCanConfigure(member, dto.parentId); // create under a site you can configure
  }
  // ... existing F2 nesting check + create ...
}

async updateProperty(member, id, patch): Promise<PropertyDto> {
  const scope = await this.permissions.scopeFilter(member);
  const existing = await this.repo.findInScope(member.organizationId, id, scope);
  if (!existing) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);
  await this.permissions.assertCanConfigure(member, existing.id);
  const newParentId = pendingParentIdFromPatch(patch);
  if (newParentId && newParentId !== existing.parentId) {
    await this.permissions.assertCanConfigure(member, newParentId); // reparent: new parent in scope too
  }
  // ... existing F2 reparent (cycle, nesting, containment) ...
}

async deleteProperty(member, id): Promise<void> {
  const scope = await this.permissions.scopeFilter(member);
  const existing = await this.repo.findInScope(member.organizationId, id, scope);
  if (!existing) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);
  await this.permissions.assertCanConfigure(member, existing.id);
  // ... existing F2 delete-block (children/devices/charters) — Task uses PERM_005 for assigned, see Phase A §4.5 ...
}
```

(`listForOrg`/`findInScope` on `PropertiesRepository` apply `scope` to the `id` column: `where: { organizationId, ...(scope && { id: { in: scope.propertyIdIn } }) }`. The `'__root__'` sentinel id is in no subtree, so `inScope` is false for everyone except OWNER, who short-circuits before the check.)

- [ ] **Step 4: Controller** — `@OrgMember()`, drop coarse gate (as Task 1 Step 6). Import `PermissionsModule`.

- [ ] **Step 5: Run → PASS.** `cd apps/api && npm run test:e2e -- properties`.

- [ ] **Step 6: Commit** `feat(api): site-scoped property reads + writes; top-level SITE create is OWNER-only`.

---

## Task 3: Networks — shared-network scoped view (spec §6)

**Files:** Modify `networks.{controller,service,repository}.ts`; extend `networks.e2e.ts`.

Rules: a `Network` is **visible** if any of its charters or devices is in scope; the caller sees only its in-scope devices/charters. **Network-level** ops (rename/delete; charter add/remove) require **every** chartered site in scope (OWNER always), else `PERM_004`. Creating a network (no charters yet) is allowed for ADMIN/OWNER.

- [ ] **Step 1: Write the failing e2e**

```typescript
it('ADMIN assigned sA sees a network spanning sA+sB but cannot rename it (PERM_004)', async () => {
  // network N chartered to sA and sB
  const list = await request(server).get('/api/v1/networks').set('Cookie', adminCookie).expect(200);
  expect(list.body.data.items.map((n: any) => n.id)).toContain(N.id); // visible via sA
  const denied = await request(server).patch(`/api/v1/networks/${N.id}`).set('Cookie', adminCookie)
    .send({ baseVersion: N.version, changes: [{ field: 'name', value: 'renamed' }] }).expect(403);
  expect(denied.body.error.code).toBe('PERM_004'); // sB not in admin's scope
});

it('ADMIN assigned BOTH sA+sB may rename the network; OWNER always may', async () => {
  await request(server).patch(`/api/v1/networks/${N.id}`).set('Cookie', adminBothCookie)
    .send({ baseVersion: N.version, changes: [{ field: 'name', value: 'ok' }] }).expect(200);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Repository — visibility query.** In `networks.repository.ts`:

```typescript
// Networks with >=1 charter OR >=1 device in the caller's scope. scope=null ⇒ all (OWNER).
async listVisible(organizationId: string, scope: { propertyIdIn: string[] } | null): Promise<Network[]> {
  if (!scope) return this.prisma.network.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } });
  return this.prisma.network.findMany({
    where: {
      organizationId,
      OR: [
        { networkLinks: { some: { propertyId: { in: scope.propertyIdIn } } } }, // NetworkProperty charters
        { devices: { some: { propertyId: { in: scope.propertyIdIn } } } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });
}

async charteredPropertyIds(organizationId: string, networkId: string): Promise<string[]> {
  const rows = await this.prisma.networkProperty.findMany({ where: { organizationId, networkId }, select: { propertyId: true } });
  return rows.map((r) => r.propertyId);
}
```

- [ ] **Step 4: Service — visibility + the `PERM_004` full-coverage check.**

```typescript
private async assertFullNetworkCoverage(member: OrganizationMember, networkId: string): Promise<void> {
  if (member.role === 'OWNER') return;
  if (member.role === 'MEMBER') throw new NodeScopeException('ORG_003', 'FORBIDDEN_ROLE', HttpStatus.FORBIDDEN);
  const charters = await this.repo.charteredPropertyIds(member.organizationId, networkId);
  for (const propertyId of charters) {
    if (!(await this.permissions.inScope(member.organizationId, member.id, propertyId))) {
      throw new NodeScopeException('PERM_004', 'NETWORK_PARTIAL_SCOPE', HttpStatus.FORBIDDEN);
    }
  }
}

async listNetworks(member: OrganizationMember): Promise<NetworkDto[]> {
  const scope = await this.permissions.scopeFilter(member);
  return (await this.repo.listVisible(member.organizationId, scope)).map(toNetworkDto);
}

// rename/delete network, and charter add/remove (the NetworkProperty endpoints) all call:
async updateNetwork(member, networkId, patch) { await this.assertFullNetworkCoverage(member, networkId); /* ...existing... */ }
async deleteNetwork(member, networkId) { await this.assertFullNetworkCoverage(member, networkId); /* ...existing... */ }
async addCharter(member, networkId, propertyId) {
  await this.assertFullNetworkCoverage(member, networkId);             // existing charters all in scope
  await this.permissions.assertCanConfigure(member, propertyId);       // and the new site is in scope too
  /* ...existing NetworkProperty create... */
}
// createNetwork: no charters yet ⇒ require ADMIN/OWNER only (assertFullNetworkCoverage passes vacuously).
async createNetwork(member, dto) { await this.assertFullNetworkCoverage(member, '<<none>>'); /* charters=[] ⇒ ok for ADMIN/OWNER */ }
```

(For `createNetwork`, `charteredPropertyIds` of a not-yet-created network is `[]`, so the loop is vacuous and only the role gate inside `assertFullNetworkCoverage` applies — MEMBER `ORG_003`, ADMIN/OWNER ok. Pass the real new id after create if you prefer; the charter list is empty either way.)

- [ ] **Step 5: Controller** — `@OrgMember()`, drop coarse gate, import `PermissionsModule`. Apply the same to the `NetworkProperty` charter controller (`addCharter`/`removeCharter` → `assertFullNetworkCoverage`).

- [ ] **Step 6: Run → PASS.** `cd apps/api && npm run test:e2e -- networks`.

- [ ] **Step 7: Commit** `feat(api): shared-network scoped view + PERM_004 full-coverage rule`.

---

## Task 4: Connections / FiberRuns / Circuits — inter-site-link rule (spec §6)

**Files:** Modify `connections.{controller,service}.ts` (template); then `fiber-runs.*` and `circuits.*`; extend each e2e.

Rule: a link is **visible** if **either** endpoint device's site is in scope (far endpoint shown as an id/name/site reference). **Create/edit/delete** requires **both** endpoint sites in scope (OWNER always), else `PERM_001`.

- [ ] **Step 1: Write the failing e2e** (`connections.e2e.ts`) — device `dA` under `sA`, `dB` under `sB`; ADMIN assigned only `sA`:

```typescript
it('ADMIN assigned sA sees the sA–sB connection but cannot delete it (PERM_001)', async () => {
  const list = await request(server).get('/api/v1/connections').set('Cookie', adminCookie).expect(200);
  expect(list.body.data.items.map((c: any) => c.id)).toContain(connAB.id); // visible via sA endpoint
  await request(server).delete(`/api/v1/connections/${connAB.id}`).set('Cookie', adminCookie)
    .expect(403).expect((r) => expect(r.body.error.code).toBe('PERM_001')); // sB endpoint out of scope
});

it('ADMIN assigned both ends, or OWNER, may delete it', async () => {
  await request(server).delete(`/api/v1/connections/${connAB.id}`).set('Cookie', adminBothCookie).expect(204);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement in `connections.service.ts`** — a helper that resolves both endpoints' governing sites:

```typescript
// Visible if EITHER endpoint device is in scope (spec §6). scope=null ⇒ all (OWNER).
async listConnections(member: OrganizationMember): Promise<ConnectionDto[]> {
  const scope = await this.permissions.scopeFilter(member);
  const rows = await this.repo.listForOrg(member.organizationId); // existing org-scoped list
  if (!scope) return rows.map(toConnectionDto);
  const visible = rows.filter((c) =>
    scope.propertyIdIn.includes(c.sourcePropertyId) || scope.propertyIdIn.includes(c.targetPropertyId),
  );
  return visible.map(toConnectionDto);
}

// Both ends in scope (or OWNER) to create/edit/delete. assertCanConfigure gives MEMBER→ORG_003, ADMIN-miss→PERM_001.
private async assertBothEndpoints(member: OrganizationMember, sourceSiteId: string, targetSiteId: string): Promise<void> {
  await this.permissions.assertCanConfigure(member, sourceSiteId);
  await this.permissions.assertCanConfigure(member, targetSiteId);
}

async createConnection(member, dto) {
  const { sourceSiteId, targetSiteId } = await this.resolveEndpointSites(member.organizationId, dto.sourceDeviceId, dto.targetDeviceId);
  await this.assertBothEndpoints(member, sourceSiteId, targetSiteId);
  /* ...existing create... */
}
async deleteConnection(member, id) {
  const conn = await this.repo.findByIdForOrg(member.organizationId, id);
  if (!conn) throw new NodeScopeException('CONN_001', 'CONNECTION_NOT_FOUND', HttpStatus.NOT_FOUND);
  // visibility: must see at least one end to even get here via a list; for a direct delete resolve both:
  const { sourceSiteId, targetSiteId } = await this.resolveEndpointSites(member.organizationId, conn.sourceDeviceId, conn.targetDeviceId);
  await this.assertBothEndpoints(member, sourceSiteId, targetSiteId);
  /* ...existing delete... */
}
```

`resolveEndpointSites` loads the two devices and returns their `propertyId`s (the F2 `governingSiteId`). If a connection model stores `sourcePropertyId`/`targetPropertyId` denormalized, prefer those; otherwise join through the devices.

- [ ] **Step 4: Controller** — `@OrgMember()`, drop coarse gate, import `PermissionsModule`.

- [ ] **Step 5: Run → PASS.** `cd apps/api && npm run test:e2e -- connections`.

- [ ] **Step 6: Apply the identical pattern to `fiber-runs` and `circuits`** — same `listX` (visible if either endpoint in scope), same `assertBothEndpoints` on create/edit/delete, same controller change. For each: add one e2e mirroring Step 1 (`PERM_001` on single-ended admin, success for both-ends/OWNER), run `npm run test:e2e -- <module>` green, commit:
  - `feat(api): inter-site-link scoping for connections`
  - `feat(api): inter-site-link scoping for fiber-runs`
  - `feat(api): inter-site-link scoping for circuits`

---

## Task 5: Retire the superseded coarse gate + phase gate

**Files:** `devices/properties/networks/connections/fiber-runs/circuits` controllers (cleanup); docs.

- [ ] **Step 1: Remove redundant `@OrgRoles('OWNER','ADMIN')`** from every site-bound mutation handler now guarded by the scoped service check (done incrementally in Tasks 1–4; sweep to confirm none remain). The global `OrgRoleGuard` stays registered (still used by F3 Phase C role/management endpoints and any non-site role gate).
- [ ] **Step 2: Cross-entity sweep** — grep `@Post`/`@Patch`/`@Put`/`@Delete` across the six controllers; confirm each site-bound mutation flows through `assertCanConfigure`/`assertFullNetworkCoverage`/`assertBothEndpoints`, and each list/get applies `scopeFilter`/visibility.
- [ ] **Step 3: Full suite.** `cd apps/api && npm run test:unit && npm run test:integration && npm run test:e2e` → all green.
- [ ] **Step 4: Docs (Rule 10).** Update the SAD/CLAUDE.md: the network model is now site-scoped (role = verb ceiling, assignment = scope), replacing F2's MEMBER-read-only/OWNER+ADMIN-mutate; note the shared-network + inter-site-link rules.
- [ ] **Step 5: Commit** `refactor(api): retire F2 coarse mutation gate, superseded by F3 scoped enforcement; docs`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** scoped reads → 404-invisibility (§6) ✓ Tasks 1–4; write decision `assertCanConfigure` OWNER/MEMBER(`ORG_003`)/ADMIN(`PERM_001`) (§5) ✓ Tasks 1–2; device move needs source+target in scope (§6) ✓ Task 1 Step 5; Property governs by self ⇒ top-level SITE create OWNER-only, sub-site under assigned site allowed (§5) ✓ Task 2; shared-network visibility + only-in-scope devices + network-level full coverage `PERM_004` (§6) ✓ Task 3; inter-site link visible via either end, mutate needs both/OWNER `PERM_001` (§6) ✓ Task 4; repository-layer chokepoint (§11) ✓ (filters in repos, asserts in services).
- **Deferred (correctly NOT here):** team/assignment management + delegation `PERM_002`/`PERM_003`, admin team-authoring, invite overlay → Phase C; realtime scope-filtering → Phase D.
- **Placeholder scan:** none — concrete code/commands throughout; the one helper stubs (`pendingPropertyIdFromPatch`, `resolveEndpointSites`) are specified in prose with exact behavior.
- **Type consistency:** `scopeFilter(member) ⇒ { propertyIdIn } | null` and `assertCanConfigure(member, siteId)` (Phase A) are consumed identically across all six entity services; `OrganizationMember` (`id`/`organizationId`/`role`) threaded via `@OrgMember()`; `inScope(org, memberId, propertyId)` reused for `PERM_004`.
- **Integration points to verify during execution:** the exact F2 connection/fiber-run/circuit models (whether endpoint `propertyId`s are denormalized or must be joined via devices — affects `resolveEndpointSites` and `listVisible`); F2's `NetworkProperty` relation name (`networkLinks`) on `Network`; that F1a's `OrgContextGuard` populates `request.orgMember` before handlers run.
