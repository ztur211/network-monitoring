# F2 — Sites & Node Grouping (the Property Hierarchy)

- **Status:** Draft for review
- **Date:** 2026-06-08
- **Spec:** F2 (permissions track — first of two; precedes F3)
- **Depends on:** F1a *Public Interface* (§10) — org tenancy, `@OrgId()`/`@OrgRoles()` guards, repository-layer scoping seam, `ChangeLog` audit, `org:{organizationId}` realtime room, `NodeScopeException`, optimistic-concurrency `version` + `ChangesetDto` patch flow, `ORG_*` error registry.
- **Downstream consumers:** **F3** (team × site × verb permissions — grants against the Property tree via this spec's anchor) and **Spec 4** (nodes in 3D — places devices, which now carry a site). Read only the *Public Interface* (§10).

---

## 1. Context

After F1a, an organization owns one shared network model (`Device`, `Network`, `DeviceConnection`, `FiberRun`, `Circuit`), isolated per org and audited. But the model is **flat** — there is no way to say *where* a node physically lives, to group nodes by location, or to scope who may touch which part of the network.

F2 introduces **sites** as a first-class, org-owned **`Property` hierarchy** — a typed, self-referencing tree (`SITE → BUILDING → FLOOR → AREA`). Every device is placed at a node in this tree, and a network declares which sites it serves. This activates the `propertyId` hook F1a reserved on `Network` (now reshaped — see §4.4), turns the flat model into a located one, and — crucially — establishes the **permission boundary** that F3 will grant against.

F2 also tightens access to match the enterprise model: regular members become **read-only** on the network model, with OWNER/ADMIN owning all mutation until F3 introduces granular, site-scoped permissions.

## 2. Goals

1. A typed, self-referencing **`Property`** tree (`SITE`/`BUILDING`/`FLOOR`/`AREA`) per org, with server-enforced nesting rules.
2. Every **`Device`** has a **required** network *and* a **required** site (`propertyId`) — its location and its F3 permission anchor.
3. A **`Network`** declares the sites it serves via an explicit **`NetworkProperty`** charter (many-to-many: a network may span sites, a site may host many networks).
4. **Containment:** a device may only be placed at/under one of its network's chartered sites.
5. **Site-aware device naming:** an org-configurable, tokenized name template (`{site}-{role}-{seq}`) that *suggests* names, layered on F1a's existing validation.
6. **Access posture:** MEMBERs are read-only across the network model; OWNER/ADMIN mutate. (F3 then replaces this with team × site × verb, including site-restricted admin scope.)
7. A clean **Public Interface** (§10) that F3 and Spec 4 build on — the site-resolution seam, DTOs, error codes, events, endpoints.

## 3. Non-Goals (explicitly out of scope for F2)

- **Teams and granular per-site view/edit/delete permissions → F3.** F2 ships only the coarse interim (MEMBER read-only / OWNER+ADMIN mutate) and the *anchor* F3 scopes against. Differentiated OWNER vs ADMIN levels and site-restricted admin scope are **F3**.
- **3D / BIM / spatial geometry.** Device `x/y/z` and the versioned `BuildingModel` are **Spec 1**; placing nodes in 3D is **Spec 4**. F2 sites are *logical* location only. Whether a `BUILDING` Property later links to a `BuildingModel` is an open question (§14), deferred.
- **Reconciling `Device.floor` with `FLOOR` nodes.** The existing free-text `floor` label is left untouched; migrating its meaning into the tree is deferred (§14).
- **Enforced name templating.** The template only *suggests*; binding enforcement remains F1a's `namingPattern` regex.
- **Pricing / tier-gating** (out of scope program-wide).

## 4. Data Model

Additive to `apps/api/prisma/schema.prisma`, except the `Device`/`Network` re-attachment changes (§4.3–4.4) and the `BROWSER_CLIENT` retirement (§4.5). All new models are org-scoped and follow F1a's conventions (repository-only access, `version` where mutable, `ChangeLog` audit, org-room events).

### 4.1 `Property` — the typed self-referencing site tree

```prisma
enum PropertyType { SITE BUILDING FLOOR AREA }

model Property {
  id             String       @id @default(uuid())
  organizationId String
  parentId       String?      // null = root (must be SITE — see §5)
  type           PropertyType
  name           String
  code           String?      // short token for site-aware naming ({site}/{building}/...)
  version        Int          @default(1)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  organization Organization      @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  parent       Property?         @relation("PropertyTree", fields: [parentId], references: [id], onDelete: Restrict)
  children     Property[]        @relation("PropertyTree")
  devices      Device[]
  networkLinks NetworkProperty[]

  @@index([organizationId])
  @@index([organizationId, parentId])
  @@index([organizationId, type])
}
```

Sibling-name uniqueness (case-insensitive, per parent) is enforced by a raw-SQL functional index — see §4.7. Add the `properties Property[]` back-relation to `Organization`.

### 4.2 `NetworkProperty` — the declared charter (which sites a network serves)

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

`organizationId` is denormalized onto the charter (consistent with `DeviceMetric`) so repository scoping is a single-column filter. Add `networkLinks NetworkProperty[]` to `Network` and `Organization`.

### 4.3 `Device` — required network + required site + role code

```prisma
model Device {
  // ... existing fields ...
  networkId  String   // WAS String? → now NOT NULL (every node belongs to a network)
  propertyId String   // NEW, NOT NULL — the device's location and F3 permission anchor
  roleCode   String?  // NEW, optional — explicit naming role; falls back to category (see §7)
  // floor: unchanged free-text label (reconciliation with FLOOR nodes deferred — §14)

  network  Network  @relation(fields: [networkId], references: [id], onDelete: Restrict)
  property Property @relation(fields: [propertyId], references: [id], onDelete: Restrict)

  @@index([organizationId, propertyId])
}
```

`networkId` was nullable to accommodate `BROWSER_CLIENT` session rows; with those retired (§4.5) it becomes `NOT NULL`. Its relation flips from `SetNull` to `Restrict` (a network with devices cannot be deleted out from under them).

### 4.4 `Network` — drop the reserved `propertyId`

The single `Network.propertyId` FK that F1a reserved cannot express a many-to-many footprint; it is **removed**. A network's site relationships now live entirely in `NetworkProperty` (declared) and are realized by its devices (actual). The existing 2D-map fields (`homeLatitude`/`homeLongitude`/`homeAddress`) are untouched.

### 4.5 `BROWSER_CLIENT` retirement (precondition / companion change)

Making `Device.networkId` `NOT NULL` requires the `BROWSER_CLIENT` device category and the `Device.browserDeviceId` column (and its `@@unique([organizationId, browserDeviceId])` index) to be **removed** first — those session-artifact rows are the only networkless devices. The retirement is driven by the broader product scope change (confirmed: `BROWSER_CLIENT` is going away); **F2's migration carries out the removal** as part of flipping `networkId` to `NOT NULL`. The implementation plan must first verify nothing else (notably realtime presence) relies on those rows.

### 4.6 `onDelete` posture

Structural links use `Restrict` so nothing structural deletes out from under live data; removals are explicit and surface clear errors (§5 delete rule, §6 charter rule):

| Relation | Behavior |
|---|---|
| `Property.parent` → `Property` | `Restrict` (can't delete a node with children) |
| `Device.property` → `Property` | `Restrict` (can't delete a placed-at site) |
| `Device.network` → `Network` | `Restrict` (can't delete a network with devices) |
| `NetworkProperty.property` → `Property` | `Restrict` (can't delete a chartered site) |
| `NetworkProperty.network` → `Network` | `Cascade` (deleting an empty network clears its charters) |
| `Property`/`NetworkProperty` → `Organization` | `Cascade` (org deletion cascades, per F1a) |

### 4.7 Uniqueness

`Property.name` is unique **among siblings, case-insensitively** — the same name may repeat under different parents (two buildings each with a "Floor 1"). Prisma can't express a functional partial index, so the migration uses raw SQL (F1a device-name precedent), with a separate partial index for roots (`parentId IS NULL`):

```sql
CREATE UNIQUE INDEX property_parent_name_lower_uniq
  ON "Property" ("organizationId", "parentId", lower("name")) WHERE "parentId" IS NOT NULL;
CREATE UNIQUE INDEX property_root_name_lower_uniq
  ON "Property" ("organizationId", lower("name")) WHERE "parentId" IS NULL;
```

## 5. Hierarchy & Nesting Rules

Enforced server-side on **create** and **reparent**:

| Parent | May contain |
|---|---|
| *(root)* | `SITE` only |
| `SITE` | `SITE`, `BUILDING`, `AREA` |
| `BUILDING` | `FLOOR`, `AREA` |
| `FLOOR` | `AREA` |
| `AREA` | `AREA` |

- A root node (`parentId = null`) must be `SITE` → else `PROP_002`.
- A child whose `type` is not permitted under its parent's `type` → `PROP_002`.
- **Reparent** (`PATCH` changing `parentId`): must not create a cycle (a node cannot become a descendant of itself → `PROP_005`), must satisfy the table above, and must not break containment for devices in the moved subtree (§6).
- **Delete** (`DELETE /v1/properties/:id`): blocked if the node's subtree contains any child Property, any placed device, or any `NetworkProperty` charter → `PROP_004`. The caller must reparent/clear first.

## 6. Containment (the charter gates placement)

The `NetworkProperty` charter is authoritative for where a network's devices may live:

- **Device create / move** (set or change `propertyId`): the target property must equal, or be a descendant of, some `P` for which `NetworkProperty(device.networkId, P)` exists → else `PROP_007`. (Resolved via `isAtOrUnder`, §10.2.)
- **Charter removal** (`DELETE …/properties/:propertyId`): blocked if any device of that network is placed at/under that property and no *other* charter of the same network still covers it → `PROP_008`. Every placed device stays covered.
- **Property reparent**: re-validated — if moving the subtree would pull any placed device outside its network's chartered coverage, the move is rejected (`PROP_007`).

Consequence: **charter first, then place.** Declared coverage is always a superset of actual placement.

## 7. Site-Aware Device Naming

A **suggestion** layer on top of F1a's validation — it never bypasses `namingPattern`, `namingMaxLen`, or case-insensitive org-uniqueness on the final name.

- **Org gains `namingTemplate String?`** (e.g. `"{site}-{role}-{seq}"`), distinct from F1a's `namingPattern` (the validator). Template *generates*; pattern *validates*.
- **Tokens**, resolved from the device's required `propertyId`:
  - `{site}` / `{building}` / `{floor}` / `{area}` → the `code` of the device's nearest ancestor of that type (empty string if that level is absent or has no `code`).
  - `{role}` → `device.roleCode ?? roleCodeOf(device.category)` (a server-side `DeviceCategory → short code` map; empty if unmapped).
  - `{seq}` → the lowest positive integer that makes the fully-substituted name unique in the org (case-insensitive), zero-padded to a configurable width (default 2 → `01`). Collision-free by construction; no stored counter.
- **Suggestion endpoint:** `GET /v1/devices/name-suggestion?networkId=&propertyId=&category=&roleCode=` → `NameSuggestionDto { suggestedName: string | null }` (`category` drives the `{role}` fallback for not-yet-created devices; `roleCode` is the optional override). Non-binding: the UI pre-fills it; the user may override. The subsequent create/rename validates as today.
- **Fallbacks:** a missing-code token resolves to empty and adjacent separators collapse; if the template is unset or can't resolve, the endpoint returns `{ suggestedName: null }` — never a blocking error.

## 8. Authority & Enforcement

- **MEMBER = read-only across the network model.** All mutation endpoints (`POST`/`PATCH`/`DELETE`) for `Property`, `NetworkProperty`, `Device`, `Network`, `DeviceConnection`, `FiberRun`, `Circuit` require `@OrgRoles('OWNER','ADMIN')`; `GET` endpoints require org membership only. A MEMBER mutation attempt → `ORG_003`. This **tightens** F1a's interim "any member may CRUD org data," and is a release requirement.
  - Because `Device.propertyId` is required and placement is OWNER/ADMIN-gated, **device creation is inherently OWNER/ADMIN-only** — there is no way to create a device without placing it.
- **OWNER/ADMIN** both have full mutate in F2. Differentiated OWNER-vs-ADMIN levels and **site-restricted** admin scope are **F3** (team × site × verb), scoped against this spec's Property tree via the §10.2 anchor.
- **Org-scoping** is inherited unchanged from F1a: every `Property`/`NetworkProperty` repository method filters by `organizationId`; the active org comes from the session; a client-supplied foreign id is ignored → `ORG_008`.
- **Audit & realtime** inherited: `Property` and `NetworkProperty` CRUD writes `ChangeLog` rows (`entityType` `'Property'` / `'NetworkProperty'`); device `ChangeLog` snapshots now carry `propertyId`/`roleCode`; new `v1:property:*` and `v1:network:charter:*` events broadcast to `org:{organizationId}`.

## 9. Migration (greenfield)

Pre-launch, no production data. The Prisma migration adds `Property`, `NetworkProperty`, `PropertyType`, the new `Device` columns (`propertyId NOT NULL`, `roleCode`), the org `namingTemplate`, drops `Network.propertyId`, retires `BROWSER_CLIENT`/`browserDeviceId`, flips `Device.networkId` to `NOT NULL` (+ `Restrict`), and adds the raw-SQL functional unique indexes (§4.7). Because re-scoped tables gain `NOT NULL` columns with no rows to backfill, it is a clean forward migration. Seed scripts are extended to create a sample site tree, charters, placed devices, and a sample `namingTemplate`.

## 10. Public Interface (the contract downstream specs cite)

Downstream specs (F3, Spec 4) read **only this section**.

### 10.1 Shared DTOs (`packages/shared`, derived from Prisma)
- `PropertyType = 'SITE' | 'BUILDING' | 'FLOOR' | 'AREA'`
- `PropertyDto { id, organizationId, parentId, type, name, code, version, createdAt, updatedAt }`
- `NetworkPropertyDto { id, networkId, propertyId }`
- `NameSuggestionDto { suggestedName: string | null }`
- `DeviceDto` gains `propertyId: string` and `roleCode: string | null`.
- `OrganizationDto` gains `namingTemplate: string | null`; F1a's `PATCH /v1/organizations/me` writable fields (`ORG_WRITABLE_FIELDS`) add `namingTemplate`.

### 10.2 Site-resolution seam (the hook F3 extends)
Exposed by `PropertiesService` / `PropertiesRepository`:
- `governingSiteId(device): string` ⇒ `device.propertyId`
- `subtreePropertyIds(propertyId): string[]` ⇒ the property and all descendants (so a grant on site *X* covers everything under *X*)
- `isAtOrUnder(propertyId, ancestorId): boolean` ⇒ the device↔grant match test (also used by §6 containment)
- F3 wraps F1a's repository-scoping convention with "…and the entity's `governingSiteId` ∈ the team's permitted subtree."

### 10.3 Error codes (register in the API Design Document before implementing)
- `PROP_001 PROPERTY_NOT_FOUND` (404)
- `PROP_002 INVALID_PARENT_TYPE` (422) — nesting rule / root-must-be-SITE
- `PROP_003 PROPERTY_NAME_TAKEN` (409) — sibling collision
- `PROP_004 PROPERTY_NOT_EMPTY` (409) — delete blocked
- `PROP_005 PROPERTY_CYCLE` (422) — reparent would loop
- `PROP_006 CHARTER_EXISTS` (409) — duplicate `NetworkProperty`
- `PROP_007 DEVICE_NOT_IN_CHARTERED_SITE` (422) — containment violation
- `PROP_008 CHARTER_IN_USE` (409) — charter removal blocked (devices rely on it)
- Reuse F1a: `ORG_003` (MEMBER attempts a mutation), `ORG_008` (cross-org), `ORG_005`/`ORG_006` (device-name uniqueness/policy on create + rename).

### 10.4 WebSocket events (constants in `realtime.types.ts`; room `org:{organizationId}`)
- `v1:property:created` / `v1:property:updated` / `v1:property:deleted` / `v1:property:moved`
- `v1:network:charter:added` / `v1:network:charter:removed`
- Existing entity events unchanged except device payloads now include `propertyId`.

### 10.5 Endpoints (mutations `OWNER`/`ADMIN`; `GET` any member)
- `GET /v1/properties` (flat list with `parentId`; client composes the tree) · `GET /v1/properties/:id`
- `POST /v1/properties` · `PATCH /v1/properties/:id` (rename/recode/reparent via `baseVersion`) · `DELETE /v1/properties/:id`
- `GET /v1/networks/:id/properties` · `POST /v1/networks/:id/properties` · `DELETE /v1/networks/:id/properties/:propertyId`
- `GET /v1/devices/name-suggestion?networkId=&propertyId=&category=&roleCode=`
- Device `POST`/`PATCH` now require `propertyId` and pass the §6 containment check.

## 11. Security Considerations

- Active org always derived from the session; foreign org/property ids in a payload are ignored → `ORG_008`. Cross-org property/charter access is invisible and logged.
- Repository-layer scoping is the single chokepoint; F3 extends exactly this seam — no query bypasses it.
- Member read-only is enforced by guards at every mutation endpoint, not by the client.
- Containment and nesting are server-side invariants; a client cannot place a device outside its network's charter or build an illegal tree.

## 12. Testing (TDD — test first)

- **Nesting:** illegal parent→child rejected (`PROP_002`); non-`SITE` root rejected (`PROP_002`).
- **Uniqueness:** case-insensitive sibling-name collision rejected (`PROP_003`); same name under different parents allowed.
- **Delete:** non-empty subtree (child / device / charter) blocked (`PROP_004`); empty node deletes.
- **Reparent:** cycle rejected (`PROP_005`); a move that breaks containment rejected (`PROP_007`).
- **Containment:** device create/move outside the charter rejected (`PROP_007`); charter removal with dependent devices rejected (`PROP_008`); duplicate charter rejected (`PROP_006`); happy-path charter-then-place succeeds.
- **Isolation:** a property/charter in org A is invisible to org B (`ORG_008`).
- **Authority:** MEMBER mutation → `ORG_003`; MEMBER `GET` allowed; MEMBER device-create blocked; OWNER and ADMIN succeed.
- **Naming:** suggestion resolves location tokens + `roleCode`-then-category fallback + `{seq}` increment; missing codes collapse; unset/unresolvable template → `null` (never blocks); final create still enforces `namingPattern`/uniqueness.
- **Audit:** property/charter CRUD writes `ChangeLog`; device snapshot carries `propertyId`/`roleCode`.

## 13. Documentation (Rule 10 — same-commit doc updates)

- Add `PROP_001`–`PROP_008` and the new `v1:property:*` / `v1:network:charter:*` events to the **API Design Document** before implementation.
- Update the SAD: the Property hierarchy, the Device-as-junction (network × site) model, the charter/containment rule, and the MEMBER-read-only posture.
- Note in CLAUDE.md module docs that the network model is now site-located and that F3 will scope permissions to the Property tree.

## 14. Open Questions (non-blocking; resolve during writing-plans / implementation)

- **`BROWSER_CLIENT` retirement scope:** confirm against the live code that no realtime-presence or other feature depends on `BROWSER_CLIENT`/`browserDeviceId` before dropping them (§4.5).
- **`Device.floor` vs `FLOOR` nodes:** keep `floor` as a free label for F2; decide later whether to migrate it into the tree.
- **`BuildingModel` linkage:** whether a `BUILDING` Property should reference Spec 1's versioned `BuildingModel` — deferred to the spatial track.
- **`{seq}` width:** whether the zero-pad width is org-configurable or fixed (default 2 assumed).
- **Property `code` requiredness:** whether `code` should be required for levels referenced by the org's `namingTemplate` (currently optional, token resolves empty if absent).
