# F1a — Organization Tenancy, Re-scoping, Audit & Enforcement

- **Status:** Draft for review
- **Date:** 2026-06-06
- **Spec:** F1a (first of the foundation layer)
- **Depends on:** nothing (it is the foundation)
- **Downstream consumers:** F1b, F2, F3, and Spec 1 cite F1a's *Public Interface* (§10)

---

## 1. Context

NodeScope today is a **per-user** application: every domain entity (`Device`, `Network`, `DeviceConnection`, `FiberRun`, `Circuit`, `DeviceMetric`, `ChangeLog`) carries a `userId` and cascades from `User`. The product is moving to a **multi-tenant, enterprise** model where a customer organization shares one network model and one BIM building reference, and a team (network designers, network engineers, tech support) collaborates on it.

F1a is the **atomic multi-tenant migration**: it makes organizations real, re-scopes all data from user-owned to org-owned, upgrades the audit trail, and moves enforcement to the org boundary. After F1a, an operator can provision an organization and its first owner, and all data access is correctly isolated per organization.

F1a deliberately stops short of team-growth flows (invitations, request-to-join) — those are **F1b** — and of node grouping/permissions — those are **F2/F3**.

## 2. Goals

1. Organizations exist as first-class tenants; every user belongs to exactly one (`OrganizationMember.userId @unique`).
2. All shared domain data is owned by an `organizationId` and isolated per org.
3. `userId` is retained as a nullable **creator** for provenance; deleting a user never deletes org data.
4. A **platform super-admin** (NodeScope staff) can provision an org, set its domain, and designate its first OWNER. This is the only way an org comes to exist in F1a.
5. The `ChangeLog` audit trail is upgraded to record create/update/delete actions, the org, a request correlation id, and actor session metadata — kept forever.
6. Device names are unique per org (case-insensitive) and validated against an **org-configurable** naming pattern.
7. Enforcement (org scoping) lives in the repository layer; the active org is always derived from the authenticated session, never from client input.

## 3. Non-Goals (explicitly out of scope for F1a)

- Invitations, request-to-join, member management UI → **F1b**.
- Sites / node grouping / the Property hierarchy → **F2**.
- Teams and granular per-site view/edit/delete permissions → **F3**.
- SSO/SAML/OIDC/SCIM. Authentication stays email/password via Better Auth; tenancy is orthogonal and SSO slots in later.
- DNS domain verification (domains are trusted in v1; the operator vouches at creation).
- Any 3D / BIM / spatial work.
- Pricing and tier-gating (out of scope per product owner). The `tier` column remains but governs nothing.

## 4. Data Model

All changes are additive to `apps/api/prisma/schema.prisma`, except FK `onDelete` behavior changes and index/uniqueness changes on re-scoped entities. Things Prisma cannot express (case-insensitive functional unique index) are applied via raw SQL in the migration, following the existing PostGIS `location` precedent.

### 4.1 New tenancy models

```prisma
model Organization {
  id            String   @id @default(uuid())
  name          String
  // Naming policy — software fits the org's convention; null = uniqueness only.
  namingPattern String?  // server-side validated regex (anchored), applied to device names
  namingMaxLen  Int?     @default(63) // DNS-safe ceiling; null = no extra cap beyond schema
  version       Int      @default(1)  // optimistic concurrency, per existing convention
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  members  OrganizationMember[]
  domains  OrganizationDomain[]
  devices       Device[]
  networks      Network[]
  connections   DeviceConnection[]
  fiberRuns     FiberRun[]
  circuits      Circuit[]
  changeLogs    ChangeLog[]
}

model OrganizationDomain {
  id             String  @id @default(uuid())
  organizationId String
  domain         String  @unique          // globally unique; one org per domain
  verified       Boolean @default(false)   // DNS verification deferred; trusted in v1
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@index([organizationId])
}

model OrganizationMember {
  id             String   @id @default(uuid())
  userId         String   @unique          // one org per user
  organizationId String
  role           OrgRole  @default(MEMBER)  // OWNER | ADMIN | MEMBER (enum already exists)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@index([organizationId])
}
```

The commented `Organization`/`OrganizationMember` stubs and the `User.orgMember` relation (currently commented) are activated and extended as above. `OrgRole` already exists.

### 4.2 Platform super-admin

```prisma
model User {
  // ... existing fields ...
  isSuperAdmin Boolean @default(false)  // NodeScope staff. SECURITY: input:false — never client-settable.
  orgMember    OrganizationMember?
}
```

`isSuperAdmin` carries the same non-negotiable protection as `tier`/`homeLatitude`: `input: false` in the Better Auth field config and never accepted from any request body. Only set via a trusted server-side path (seed/console).

### 4.3 Re-scoping transform

Every shared entity gets `organizationId` (owner) and keeps `userId` (creator, now nullable). `Device` is the worked example; the same transform applies to `Network`, `DeviceConnection`, `FiberRun`, `Circuit`, and `ChangeLog`.

```prisma
model Device {
  id             String         @id @default(uuid())
  organizationId String         // NEW — scoping key
  userId         String?        // WAS required owner; NOW nullable "created-by"
  // ... all other fields unchanged ...

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User?        @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([organizationId])
  @@index([organizationId, category])
  @@index([organizationId, floor])
  @@index([organizationId, networkId])
  // @@unique([organizationId, name]) is replaced by a case-insensitive functional
  // unique index created in raw SQL (see 4.5). browserDeviceId identifies a user's
  // personal browser session (BROWSER_CLIENT) and stays user-scoped; its exact
  // constraint is settled in the implementation plan.
}
```

Per-entity notes:
- **`DeviceMetric`** (TimescaleDB hypertable): add `organizationId` as a **plain indexed column**, no Prisma relation — matching how `deviceId` is already handled. Add `@@index([organizationId, time(sort: Desc)])`. App-layer handles cascade.
- **`ChangeLog`**: see §5 (also gains `action`, `requestId`, actor metadata).
- **`Network`**: `propertyId` stays reserved/untouched (F2 activates it).

### 4.4 FK `onDelete` changes (correctness-critical)

| Relation | Today | F1a |
|---|---|---|
| entity → `User` (`userId`) | `Cascade` | `SetNull` (userId becomes nullable) |
| entity → `Organization` (`organizationId`) | — | `Cascade` |

Rationale: ownership is the org's. Deleting a user must preserve org data (creator becomes null). Deleting an org cascades its data. `OrganizationMember` → `User` stays `Cascade` (a membership is meaningless without its user).

### 4.5 Case-insensitive uniqueness

Device names are unique **per org, case-insensitively**. Prisma cannot express a functional unique index, so the migration runs raw SQL (PostGIS precedent):

```sql
CREATE UNIQUE INDEX device_org_name_lower_uniq
  ON "Device" ("organizationId", lower("name"));
```

The repository normalizes on write (rejects collisions atomically) and surfaces `ORG_005`.

## 5. Audit Log Upgrade (full)

`ChangeLog` becomes a complete audit trail.

```prisma
enum ChangeAction { CREATE UPDATE DELETE }

model ChangeLog {
  id             String       @id @default(uuid())
  organizationId String       // NEW — per-org audit
  userId         String?      // actor; set from session at write time, nulled only if the user is later deleted
  requestId      String       // NEW — correlation id; groups all rows from one request
  action         ChangeAction // NEW — CREATE/UPDATE/DELETE first-class
  entityType     String
  entityId       String
  field          String?      // null for CREATE/DELETE event rows
  oldValue       String?
  newValue       String?
  snapshot       Json?        // NEW — full object on CREATE/DELETE
  ipAddress      String?      // NEW — actor session metadata
  userAgent      String?      // NEW
  comment        String?      // NEW — optional rationale/ticket ref
  createdAt      DateTime     @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User?        @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([organizationId, entityType, entityId])
  @@index([organizationId, createdAt(sort: Desc)])
  @@index([requestId])
}
```

- **Shape by action:** `UPDATE` writes one row per changed field (existing behavior). `CREATE`/`DELETE` write a single row with `field = null` and the object in `snapshot`.
- **Correlation:** a NestJS middleware/interceptor assigns one `requestId` (UUID) per inbound request, stored in request-scoped context and stamped on every `ChangeLog` row that request produces.
- **Retention:** kept forever. No purge job in F1a.
- **Actor integrity:** `userId`, `ipAddress`, `userAgent` are taken from the authenticated session/request at write time, never from the body. `userId` is non-null when written and nulls only if that user is later deleted (audit content survives — kept forever).

## 6. Naming Policy

- Each org optionally sets `namingPattern` (an anchored regex) and `namingMaxLen` (≤ 63 default).
- On device create/rename the repository enforces, server-side: (a) case-insensitive org uniqueness, (b) `namingMaxLen`, (c) `namingPattern` if set. Violations → `ORG_006`.
- If `namingPattern` is null, only uniqueness + max length apply. NodeScope ships **no mandatory scheme** — it fits the customer's convention.
- Auto-suggestion and site-aware tokens (`{site}-{role}-{seq}`) are **F2+** (they need sites). F1a is validation only.

## 7. Provisioning (minimal, super-admin only)

Just enough for the system to be usable; team-growth flows are F1b.

- A super-admin (`isSuperAdmin`) calls protected endpoints to:
  1. Create an `Organization`.
  2. Attach one or more `OrganizationDomain`s.
  3. Designate the **first OWNER**: given an email, find or link the `User` and create an `OrganizationMember` with role `OWNER`.
- These endpoints sit behind a `SuperAdminGuard` (checks `socket/request.user.isSuperAdmin`), separate from normal org endpoints.

## 8. Enforcement

- **Active org from session:** a request's org is resolved from the authenticated user's `OrganizationMember`, exposed via an `@OrgId()` param decorator (and `socket.data.orgId` for WS). Client-supplied org ids are ignored/rejected (`ORG_008`).
- **Repository-layer scoping:** every org-scoped repository method filters by `organizationId`. No direct Prisma calls outside repositories (existing rule). This is the exact hook F3 later extends with site/verb grant checks.
- **Real-time rooms:** on socket connect, `RealtimeService` joins the socket to room `org:{organizationId}`; entity events emit to that room so teammates sync live. AI conversation channels stay per-user (`ai:conv:{userId}:{conversationId}`). All Socket.io stays inside `RealtimeService` (existing rule).
- **Org-role checks:** an `OrgRoleGuard` gates org-admin actions (e.g. editing org settings/naming policy requires ADMIN/OWNER). Node-level CRUD permissions are F3; in F1a any member may CRUD org data.

## 9. Migration (greenfield)

NodeScope is pre-launch with no production data to preserve.

- The Prisma migration adds the new models/columns, flips `onDelete` behaviors, adds `organizationId` (NOT NULL) to re-scoped tables, and creates the raw-SQL functional unique index.
- Existing dev/seed data is reset; seed scripts are rewritten to create a sample org, a super-admin, a first OWNER, and org-scoped sample data.
- Because tables gain a NOT NULL `organizationId` with no rows to backfill, the migration is a clean forward migration. No data backfill logic is required.

## 10. Public Interface (the contract downstream specs cite)

Downstream specs (F1b, F2, F3, Spec 1) should read **only this section**, not the rest of F1a.

### 10.1 Shared DTOs (`packages/shared`, derived from Prisma — no hand-written duplicate types)
- `OrganizationDto { id, name, namingPattern?, namingMaxLen?, version }`
- `OrganizationDomainDto { id, domain, verified }`
- `OrganizationMemberDto { id, userId, organizationId, role }`
- Every existing entity DTO (`DeviceDto`, etc.) gains `organizationId` and a nullable `createdByUserId` (the renamed-in-DTO meaning of `userId`).

### 10.2 Org resolution
- Backend: `@OrgId()` param decorator → `string` (active org id from session). `@SuperAdmin()` guard. `@OrgRoles(OWNER, ADMIN)` guard.
- The org-scoping repository convention: all org-scoped queries take `organizationId` and filter on it. F3 extends this seam.

### 10.3 Error codes (add to API Design Doc v1.0 *before* implementing — existing rule)
- `ORG_001 ORGANIZATION_NOT_FOUND`
- `ORG_002 NOT_AN_ORG_MEMBER`
- `ORG_003 INSUFFICIENT_ORG_ROLE`
- `ORG_004 DOMAIN_ALREADY_CLAIMED`
- `ORG_005 DEVICE_NAME_TAKEN`
- `ORG_006 NAMING_POLICY_VIOLATION`
- `ORG_007 SUPERADMIN_REQUIRED`
- `ORG_008 CROSS_ORG_ACCESS_DENIED`

### 10.4 WebSocket events (constants in `realtime.types.ts`; room = `org:{organizationId}`)
- `v1:org:updated` (org settings/naming policy changed)
- `v1:org:member:added` / `v1:org:member:updated` / `v1:org:member:removed`
- (Existing entity events now scope to the org room rather than a user room.)

### 10.5 Super-admin endpoints (behind `SuperAdminGuard`)
- `POST /api/v1/admin/organizations` → create org
- `POST /api/v1/admin/organizations/:id/domains` → add domain
- `POST /api/v1/admin/organizations/:id/owner` → designate first OWNER by email

### 10.6 Org endpoints
- `GET /api/v1/organizations/me` → current user's org
- `GET /api/v1/organizations/me/members` → org roster
- `PATCH /api/v1/organizations/me` (OWNER/ADMIN) → name + naming policy (optimistic concurrency via `ChangesetDto` `baseVersion`)

## 11. Security Considerations

- `isSuperAdmin` and `tier`: `input: false`, never client-settable.
- Active org is **always** derived from the authenticated session; any org id in a payload is ignored. Cross-org access attempts return `ORG_008` and are logged.
- Repository-layer scoping is the single chokepoint; no Prisma access bypasses it.
- Audit actor fields come from the session/request, never the body.
- Better Auth remains the only authentication authority; F1a adds authorization/tenancy on top.

## 12. Testing (TDD — test first, always)

Write the failing test before each implementation unit. Key cases:
- **Isolation:** user in org A cannot read/update/delete any entity in org B (every repository method).
- **Session-derived org:** a request that supplies a foreign `organizationId` in the body is ignored; the session org wins.
- **Cascade behavior:** deleting a `User` nulls `userId` and preserves entities; deleting an `Organization` cascades all its data.
- **Uniqueness:** case-insensitive device-name collision within an org is rejected (`ORG_005`); the same name in a different org is allowed.
- **Naming policy:** names violating `namingPattern`/`namingMaxLen` are rejected (`ORG_006`); null pattern allows any unique name.
- **Audit:** create writes a CREATE row with snapshot; multi-field update writes one row per field sharing a `requestId`; delete writes a DELETE row; actor + IP/UA captured from session.
- **Super-admin guard:** non-super-admin calling `/admin/*` gets `ORG_007`.
- **Org-role guard:** MEMBER cannot PATCH org settings (`ORG_003`).

## 13. Documentation (Rule 10 — same-commit doc updates)

- Add `ORG_001`–`ORG_008` to **API Design Document v1.0** before implementation.
- Add the new WS events to the API Design Doc and `realtime.types.ts`.
- Update SAD multi-tenancy section and CLAUDE.md module notes to reflect org scoping.
- Note the `User.isSuperAdmin` `input:false` rule alongside the existing `tier` security note.

## 14. Open Questions (non-blocking; resolve during writing-plans/implementation)

- Exact mechanism for request-scoped `requestId` propagation in NestJS (AsyncLocalStorage vs. request-scoped provider).
- Whether `snapshot` should redact any sensitive device fields (none currently sensitive).
- `citext` extension vs. functional `lower()` index — both work; functional index chosen to avoid an extension dependency.
