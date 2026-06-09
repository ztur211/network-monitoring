# F2 Phase D — Member Read-Only Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the release requirement that a plain **MEMBER is read-only across the whole network model** — every mutating endpoint (create/update/delete) on `Property`, `NetworkProperty`, `Device`, `Network`, `DeviceConnection`, `FiberRun`, `Circuit` requires `OWNER`/`ADMIN`; `GET` endpoints stay open to any member. A MEMBER mutation attempt returns `ORG_003`.

**Architecture:** Register `OrgRoleGuard` as a **global** `APP_GUARD` (after `AuthGuard` and `OrgContextGuard`). It is a no-op on handlers without `@OrgRoles` metadata, so it leaves `GET`s, super-admin endpoints (`@RequireSuperAdmin`), and the AuthGuard-only invite/join endpoints untouched — while enforcing `@OrgRoles('OWNER','ADMIN')` wherever we add it. Then annotate every mutation handler. This tightens F1a's interim "any member may CRUD."

**Tech Stack:** NestJS, Jest. No schema change.

**Depends on:** F1a (`OrgRoleGuard`, `@OrgRoles`, `OrgContextGuard`, `ORG_003`), F2 Phases A–C (the property/charter/device controllers; properties + charters are already `@OrgRoles`-gated and will be deduplicated). Spec: `2026-06-08-f2-sites-node-grouping-design.md` (§8).

> Confirm from F1a Phase B whether `OrgContextGuard` is already a global `APP_GUARD` (it should be). `OrgRoleGuard` must be registered **after** it so `request.orgMember` is populated before role checks run.

---

## File Structure

**Modify:**
- `apps/api/src/app.module.ts` — register `OrgRoleGuard` as a global `APP_GUARD`
- `apps/api/src/devices/devices.controller.ts`
- `apps/api/src/networks/networks.controller.ts`
- `apps/api/src/connections/connections.controller.ts`
- `apps/api/src/fiber-runs/fiber-runs.controller.ts`
- `apps/api/src/circuits/circuits.controller.ts`
- (`properties.controller.ts` / `network-property.controller.ts` already gated — optionally drop now-redundant per-controller `OrgRoleGuard` from `@UseGuards`)

---

## Task 1: Register `OrgRoleGuard` globally

**Files:** Modify `apps/api/src/app.module.ts`.

- [ ] **Step 1: Add the global guard** after the existing `AuthGuard` and `OrgContextGuard` `APP_GUARD` registrations:

```typescript
import { APP_GUARD } from '@nestjs/core';
import { OrgRoleGuard } from './organizations/guards/org-role.guard';
// providers: [
//   ...AuthGuard APP_GUARD...,
//   ...OrgContextGuard APP_GUARD...,
{ provide: APP_GUARD, useClass: OrgRoleGuard },
// ]
```

Ensure `OrganizationsModule` is imported so `OrgRoleGuard`'s `Reflector` dependency resolves (it's a standard Nest provider; no extra wiring beyond the guard class). `OrgRoleGuard` returns `true` when a handler has no `@OrgRoles` metadata, so all existing routes are unaffected until annotated.

- [ ] **Step 2: Verify the existing suite still passes.** `cd apps/api && npm run test:unit && npm run test:e2e` → green (no handler is annotated yet, so behavior is unchanged).

- [ ] **Step 3: Commit** `feat(api): register OrgRoleGuard globally (no-op until @OrgRoles applied)`.

---

## Task 2: Gate `Device` mutations + e2e

**Files:** Modify `devices.controller.ts`; test (extend the device e2e).

- [ ] **Step 1: Annotate mutations.** Add `@OrgRoles('OWNER', 'ADMIN')` to the `@Post()`, `@Patch(':id')`, and `@Delete(':id')` handlers in `DevicesController`. Leave `@Get()`, `@Get(':id')`, and `@Get('name-suggestion')` unannotated. Import `OrgRoles` from `../organizations/decorators/org-roles.decorator`.

- [ ] **Step 2: Write the failing e2e** — with a `MEMBER` `currentUser`: `GET /v1/devices` → 200; `POST /v1/devices` → 403 with `code === 'ORG_003'`; `PATCH`/`DELETE` → 403. With an `OWNER`: the same mutations succeed (given a valid `networkId`/`propertyId` under a charter).

```typescript
it('MEMBER is read-only on devices; OWNER may mutate', async () => {
  // ... seed org, owner+member memberships, a SITE, a network chartered to it ...
  currentUser = { id: member.id, isSuperAdmin: false };
  await request(server).get('/v1/devices').expect(200);
  const denied = await request(server).post('/v1/devices')
    .send({ name: 'X', category: 'ROUTER', networkId, propertyId }).expect(403);
  expect(denied.body.code).toBe('ORG_003');

  currentUser = { id: owner.id, isSuperAdmin: false };
  await request(server).post('/v1/devices')
    .send({ name: 'rtr-1', category: 'ROUTER', networkId, propertyId }).expect(201);
});
```

- [ ] **Step 3: Run → first FAIL (member POST currently allowed), then PASS** after Step 1. `cd apps/api && npm run test:e2e -- devices`.

- [ ] **Step 4: Commit** `feat(api): MEMBER read-only on devices (OWNER/ADMIN mutate)`.

---

## Task 3: Gate the remaining entity mutations

**Files:** Modify `networks.controller.ts`, `connections.controller.ts`, `fiber-runs.controller.ts`, `circuits.controller.ts`.

Apply the identical change to each controller — add `@OrgRoles('OWNER', 'ADMIN')` to every mutating handler (`@Post`, `@Patch`, `@Put`, `@Delete`), leave `@Get` handlers open, import the `OrgRoles` decorator.

- [ ] **`networks`** — annotate all mutations. Commit `feat(api): MEMBER read-only on networks`.
- [ ] **`connections`** — annotate all mutations. Commit `feat(api): MEMBER read-only on connections`.
- [ ] **`fiber-runs`** — annotate all mutations. Commit `feat(api): MEMBER read-only on fiber-runs`.
- [ ] **`circuits`** — annotate all mutations. Commit `feat(api): MEMBER read-only on circuits`.

For each: add one e2e assertion that a `MEMBER` mutation returns 403 `ORG_003` and a `GET` returns 200 (mirror Task 2 Step 2), run `npm run test:e2e -- <module>` green before committing.

- [ ] **(Optional cleanup)** In `properties.controller.ts` and `network-property.controller.ts`, the per-controller `OrgRoleGuard` in `@UseGuards` is now redundant with the global guard — you may remove it from the `@UseGuards` list (keep the `@OrgRoles` annotations). Behavior is identical either way.

---

## Task 4: Full suite + docs

- [ ] **Step 1: Full suite.** `cd apps/api && npm run test:unit && npm run test:integration && npm run test:e2e` → all green.
- [ ] **Step 2: Cross-entity sweep** — confirm no mutating handler across the seven entity controllers lacks `@OrgRoles('OWNER','ADMIN')` (grep for `@Post`/`@Patch`/`@Put`/`@Delete` and check each has the decorator, except the genuinely public ones — there are none in the network model).
- [ ] **Step 3: Docs (Rule 10).** Note in the SAD/CLAUDE.md that the network model is OWNER/ADMIN-write, MEMBER-read in F2, and that F3 will replace this with granular team × site × verb (incl. site-restricted admin scope).
- [ ] **Step 4: Commit** `docs: record MEMBER read-only posture; test: full suite green`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** MEMBER read-only across the whole network model (§8) ✓ Tasks 1-3; `ORG_003` on member mutation (§8/§10.3) ✓ Tasks 2-3; GETs stay open (§8) ✓ (unannotated); OWNER/ADMIN mutate (§8) ✓. Differentiated/site-restricted admin scope correctly deferred to F3 (§3).
- **Mechanism:** global `OrgRoleGuard` after `OrgContextGuard`; no-op without `@OrgRoles`, so super-admin (`@RequireSuperAdmin`) and AuthGuard-only invite/join endpoints are unaffected; only annotated mutations are gated.
- **Type/behavior consistency:** every entity controller's mutating verbs carry `@OrgRoles('OWNER','ADMIN')`; reads carry none; `name-suggestion` (Phase C) intentionally left open.
- **Integration points to verify during execution:** that `OrgContextGuard` is already a global `APP_GUARD` and `OrgRoleGuard` is registered after it (Task 1); the exact e2e `AuthGuard`-override/mutable-`currentUser` mechanism (Task 2).
