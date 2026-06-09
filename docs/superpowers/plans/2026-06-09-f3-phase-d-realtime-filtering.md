# F3 Phase D — Realtime Scope-Filtered Fan-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop broadcasting every entity event to the whole org. A socket receives a site-bound event only if the event's governing site is within the socket's assigned scope (OWNER receives all). Add `v1:access:changed` so a user whose teams/assignments/role change re-syncs its subscriptions.

**Architecture:** Per **assigned-root rooms**. On connect, an OWNER socket joins `org:{orgId}:all`; a scoped socket joins `org:{orgId}:root:{rootId}` for each of its effective roots. A site-bound event at site `S` is emitted to `org:{orgId}:all` **plus** `org:{orgId}:root:{a}` for every `a` in `S`'s ancestor-or-self chain — so exactly the sockets assigned an ancestor of `S` receive it (mirrors the Phase B read filter). This keeps room counts ≈ (assigned roots per user), not (every property), and works across instances via the existing Socket.io Redis adapter. On an access change the server emits `v1:access:changed`; the client refetches `GET /v1/access/me` and emits `resync`, and the gateway recomputes that one socket's root rooms.

**Tech Stack:** NestJS 11, Socket.io (+ Redis adapter), Jest e2e with `socket.io-client` on test DB `:5433`. No schema change.

**Depends on:**
- **F3 Phase A** — `PermissionsService` (`effectiveRoots`, `inScope`), `PermissionsRepository.findMember`.
- **F3 Phase B** — services already resolve each entity's governing site (so emit call sites have it).
- **F3 Phase C** — the team/assignment mutations that must fire `v1:access:changed`.
- **F1a/F2 realtime** — the `RealtimeGateway` (Socket.io, Redis adapter, `user:{userId}` rooms, `org:{organizationId}` room + `pushToOrg` from F1a Phase D) and the central `emitEntityEvent` path; `WS_EVENTS` in `@nodescope/shared`; `PropertiesService` for the ancestor query.
- Spec: `2026-06-09-f3-team-site-verb-permissions-design.md` (§8 realtime).

> Confirm F1a Phase D actually shipped org rooms + `pushToOrg`. If realtime still emits per-user (`pushToUser`), this phase replaces the per-user fan-out for the network model with the scoped org fan-out below; the `user:{userId}` room stays for `v1:access:changed` and presence.

---

## File Structure

**Create:**
- `apps/api/src/permissions/__tests__/permissions-ancestors.service.spec.ts` (integration via `*.repository.spec.ts` naming — see Task 1)
- `apps/api/src/realtime/__tests__/realtime-scope.e2e.ts` (WS e2e)

**Modify:**
- `apps/api/src/permissions/permissions.repository.ts` — `ancestorPropertyIds`
- `apps/api/src/permissions/permissions.service.ts` — `ancestorRoomsFor`, `effectiveRootRooms`
- `apps/api/src/realtime/realtime.gateway.ts` — scoped room join on connect; `emitScoped`; `@SubscribeMessage('resync')`
- `apps/api/src/realtime/realtime.types.ts` (or `@nodescope/shared` `realtime.types.ts`) — `ACCESS_CHANGED: 'v1:access:changed'`
- The entity services (`devices`/`properties`/`networks`/`connections`/`fiber-runs`/`circuits`) and Phase C mutations — route site-bound emits through `emitScoped`; fire `ACCESS_CHANGED`.

---

## Task 1: `ancestorPropertyIds` (integration TDD)

**Files:** Modify `permissions.repository.ts`; test `__tests__/permissions.repository.spec.ts` (extend Phase A's).

The recipient rooms for an event at site `S` are the rooms of `S` and all its ancestors. Add the upward query (recursive CTE), mirroring F2's downward `subtreePropertyIds`.

- [ ] **Step 1: Add the failing integration test** (extend Phase A's `permissions.repository.spec.ts`)

```typescript
it('ancestorPropertyIds returns the node and every ancestor', async () => {
  const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'HQ' } });
  const bld = await prisma.property.create({ data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'A' } });
  const flr = await prisma.property.create({ data: { organizationId: orgId, parentId: bld.id, type: 'FLOOR', name: '1' } });
  const ids = await repo.ancestorPropertyIds(orgId, flr.id);
  expect(ids.sort()).toEqual([site.id, bld.id, flr.id].sort());
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:integration -- permissions`.

- [ ] **Step 3: Implement** (append to `PermissionsRepository`)

```typescript
async ancestorPropertyIds(organizationId: string, propertyId: string): Promise<string[]> {
  const rows = await this.prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE ancestors AS (
      SELECT "id", "parentId" FROM "Property"
        WHERE "id" = ${propertyId} AND "organizationId" = ${organizationId}
      UNION ALL
      SELECT p."id", p."parentId" FROM "Property" p
        JOIN ancestors a ON p."id" = a."parentId" AND p."organizationId" = ${organizationId}
    )
    SELECT "id" FROM ancestors;
  `;
  return rows.map((r) => r.id);
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): ancestorPropertyIds (upward CTE) for scoped realtime fan-out`.

---

## Task 2: Scoped room join + `emitScoped` on the gateway

**Files:** Modify `realtime.gateway.ts`, `permissions.service.ts`, `realtime.types.ts`.

- [ ] **Step 1: Add room helpers to `PermissionsService`**

```typescript
/** Rooms a socket joins: OWNER → ['org:{org}:all']; else one per effective root. */
async effectiveRootRooms(member: OrganizationMember): Promise<string[]> {
  if (member.role === 'OWNER') return [`org:${member.organizationId}:all`];
  const roots = await this.effectiveRoots(member.organizationId, member.id);
  return roots.map((r) => `org:${member.organizationId}:root:${r}`);
}

/** Rooms an event at `governingSiteId` targets: the org-all room + every ancestor-or-self root room. */
async ancestorRoomsFor(organizationId: string, governingSiteId: string): Promise<string[]> {
  const ancestors = await this.repo.ancestorPropertyIds(organizationId, governingSiteId);
  return [`org:${organizationId}:all`, ...ancestors.map((a) => `org:${organizationId}:root:${a}`)];
}
```

- [ ] **Step 2: Join scoped rooms on connect.** In `realtime.gateway.ts` `handleConnection`, after the existing session validation + `user:{userId}` join, resolve the member and join its scoped rooms:

```typescript
const member = await this.permissions['repo'].findMember(orgId, userId); // or inject PermissionsRepository
if (member) {
  for (const room of await this.permissions.effectiveRootRooms(member)) {
    await client.join(room);
  }
  client.data.memberId = member.id;
  client.data.organizationId = orgId;
}
```

(Inject `PermissionsService` + `PermissionsRepository` into the gateway via `RealtimeModule` importing `PermissionsModule`.)

- [ ] **Step 3: Add `emitScoped`** to the gateway:

```typescript
async emitScoped(organizationId: string, governingSiteId: string, event: string, payload: unknown): Promise<void> {
  const rooms = await this.permissions.ancestorRoomsFor(organizationId, governingSiteId);
  this.server.to(rooms).emit(event, payload); // Socket.io dedupes recipients across rooms
}
```

- [ ] **Step 4: Add the event constant** `ACCESS_CHANGED: 'v1:access:changed'` to `WS_EVENTS` in `realtime.types.ts`; `cd packages/shared && npm run build`.

- [ ] **Step 5: `npx tsc --noEmit` + commit** `feat(api): scoped realtime rooms + emitScoped + v1:access:changed constant`.

---

## Task 3: Route site-bound events through `emitScoped`

**Files:** Modify the entity services' emit call sites.

- [ ] **Step 1: Devices (template).** Where `devices.service.ts` emits `DEVICE_*`, replace the org-wide/per-user emit with the scoped one using the device's governing site:

```typescript
await this.realtime.emitScoped(member.organizationId, device.propertyId, WS_EVENTS.DEVICE_UPDATED, {
  deviceId: device.id, device: dto, updatedBy: member.id,
});
```

- [ ] **Step 2: Properties.** Emit `v1:property:*` scoped to the property's own id (its governing site is itself): `emitScoped(orgId, property.id, WS_EVENTS.PROPERTY_UPDATED, …)`. For `property:deleted`/`moved`, emit to the **pre-change** site (and, for a move, also the new parent's site) so both old and new viewers update.

- [ ] **Step 3: Networks & charters (shared-network rule).** A network/charter event must reach everyone who can see the network. Emit to the **union** of ancestor-rooms over the network's chartered sites:

```typescript
const charterSites = await this.networksRepo.charteredPropertyIds(orgId, networkId);
const rooms = [...new Set((await Promise.all(
  charterSites.map((s) => this.permissions.ancestorRoomsFor(orgId, s)),
)).flat())];
this.realtime.server.to(rooms).emit(WS_EVENTS.NETWORK_UPDATED, payload);
```

(Expose a thin `realtime.emitToRooms(rooms, event, payload)` to avoid reaching into `server` from services.)

- [ ] **Step 4: Connections / fiber-runs / circuits (inter-site-link rule).** Emit to the union of ancestor-rooms over **both** endpoint sites (so either-end viewers update): `emitToRooms([...ancestorRooms(sourceSite), ...ancestorRooms(targetSite)] deduped, …)`.

- [ ] **Step 4b: Team/assignment lifecycle events** (emitted in Phase C, Task 7) route to owners + whoever covers the team's sites: emit `TEAM_*`/`TEAM_PROPERTY_*` to `['org:{org}:all', ...union of ancestor-rooms over the team's assigned sites]` (deduped); emit `MEMBER_PROPERTY_*` to that member's `user:{userId}` + `org:{org}:all`.

- [ ] **Step 5: e2e — WS scope filter** (`realtime-scope.e2e.ts`, `socket.io-client`): connect a MEMBER socket scoped to `sA` and a MEMBER socket scoped to `sB`; trigger a device update under `sA` (via the API as OWNER); assert the `sA` socket receives `v1:device:updated` and the `sB` socket does **not** (use a short timeout). Connect an OWNER socket and assert it receives both.

```typescript
it('a socket only receives events for sites in its scope', async () => {
  const got: string[] = [];
  sockA.on(WS_EVENTS.DEVICE_UPDATED, (p: any) => got.push(`A:${p.deviceId}`));
  sockB.on(WS_EVENTS.DEVICE_UPDATED, (p: any) => got.push(`B:${p.deviceId}`));
  await ownerUpdateDevice(deviceUnderA.id); // API call
  await waitMs(300);
  expect(got).toContain(`A:${deviceUnderA.id}`);
  expect(got).not.toContain(`B:${deviceUnderA.id}`);
});
```

- [ ] **Step 6: Run → PASS.** `cd apps/api && npm run test:e2e -- realtime-scope`. Commit `feat(api): scope-filter realtime fan-out for the network model`.

---

## Task 4: `v1:access:changed` + `resync`

**Files:** Modify `realtime.gateway.ts`; the Phase C mutations (team membership/assignment, direct grants) and any role-change handler.

- [ ] **Step 1: Gateway — emit helper + resync handler.**

```typescript
notifyAccessChanged(organizationId: string, userId: string): void {
  this.server.to(`user:${userId}`).emit(WS_EVENTS.ACCESS_CHANGED, { organizationId });
}

@SubscribeMessage('resync')
async onResync(@ConnectedSocket() client: Socket): Promise<void> {
  const { organizationId, memberId } = client.data ?? {};
  if (!organizationId || !memberId) return;
  // leave stale scoped rooms for this org, re-join current ones
  for (const room of [...client.rooms]) {
    if (room.startsWith(`org:${organizationId}:root:`) || room === `org:${organizationId}:all`) {
      await client.leave(room);
    }
  }
  const member = await this.permissions['repo'].findMember(organizationId, /* userId from session */ client.data.userId);
  if (member) for (const room of await this.permissions.effectiveRootRooms(member)) await client.join(room);
}
```

- [ ] **Step 2: Fire on access change.** In the Phase C use-cases that change a member's reachable sites or role — `addMemberToTeam`/`removeMemberFromTeam`, `assignSiteToTeam`/`unassignSiteFromTeam` (affects **all** members of that team), `grantSiteToMember`/`revokeSiteFromMember`, and any role change — call `notifyAccessChanged(orgId, affectedUserId)` for each affected user. For team-site changes, fan out to every member of the team (look up their `userId`s). Inject the gateway (via `REALTIME_SERVICE`) into `PermissionsService`/its callers.

- [ ] **Step 3: e2e** — a MEMBER socket scoped to `sA` is added (as OWNER) to a team covering `sB`; assert the socket receives `v1:access:changed`; after the client emits `resync`, a device update under `sB` now reaches it.

- [ ] **Step 4: Run → PASS.** Commit `feat(api): v1:access:changed + resync re-subscribes a socket's scoped rooms`.

---

## Task 5: Phase gate + docs

- [ ] **Step 1: Full suite.** `cd apps/api && npm run test:unit && npm run test:integration && npm run test:e2e` → all green.
- [ ] **Step 2: Sweep** — confirm no site-bound entity event still uses the unfiltered org-wide/per-user broadcast (grep the services for direct `pushToOrg`/`pushToUser`/`emitEntityEvent` on network-model entities; all should now be `emitScoped`/`emitToRooms`). `user:{userId}` stays only for `ACCESS_CHANGED` + presence.
- [ ] **Step 3: Docs (Rule 10).** Update the SAD/API Design Document: realtime is now scope-filtered (per-assigned-root rooms + ancestor-chain emit); document `v1:access:changed` + the client `resync` contract.
- [ ] **Step 4: Commit** `docs: F3 scope-filtered realtime + access-changed contract`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** single org room replaced by scope-filtered fan-out — a socket never receives an event for a site it can't query (§8) ✓ Tasks 2–3; OWNER receives all (`:all` room) ✓ Task 2; network/charter + inter-site-link events reach exactly their visibility set (§6/§8) ✓ Task 3 Steps 3–4; `v1:access:changed` on team/assignment/role change + re-resolve (§8) ✓ Task 4.
- **Mechanism soundness:** per-assigned-root rooms + ancestor-chain emit is equivalent to the Phase B `isAtOrUnder` read filter (a socket in `root:{r}` gets an event at `S` iff `r` ∈ ancestors(`S`) iff `isAtOrUnder(S, r)`), so realtime visibility == read visibility. Cross-instance via the existing Redis adapter (rooms, not in-process socket iteration).
- **Placeholder scan:** none; emit-site rules are concrete per entity type. The one impl note (`findMember` via the userId on `client.data`) is specified.
- **Type consistency:** `effectiveRootRooms(member)` / `ancestorRoomsFor(org, site)` (service) ↔ `ancestorPropertyIds(org, site)` (repo) ↔ `emitScoped`/`emitToRooms`/`notifyAccessChanged` (gateway) used consistently across Tasks 2–4; `WS_EVENTS.ACCESS_CHANGED`.
- **Integration points to verify during execution:** whether F1a Phase D actually shipped org rooms/`pushToOrg` (else this phase establishes the org-room fan-out); the gateway's DI for `PermissionsService`/`PermissionsRepository` (cycle check — use `forwardRef` if `PermissionsModule` ↔ `RealtimeModule` import each other); the exact `client.data.userId` availability after F1a's session validation.
- **Known cost (flagged, spec §14):** a socket joins one room per effective root and `emitScoped` runs an ancestor CTE per event — acceptable at expected scale; revisit (cache ancestor chains / materialize closure) if event volume is hot.
