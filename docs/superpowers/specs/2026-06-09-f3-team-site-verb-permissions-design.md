# F3 — Team × Site Permissions (Role × Site-Scoped Assignment)

- **Status:** Draft for review
- **Date:** 2026-06-09
- **Spec:** F3 (permissions track — second of two; follows F2)
- **Depends on:**
  - **F1a** *Public Interface* (§10) — org tenancy, the `OrgRole` enum + `OrganizationMember.role`, `@OrgId()`/`@OrgRoles()` guards, the repository-layer scoping seam, `ChangeLog` audit, the `org:{organizationId}` realtime room, `NodeScopeException`, optimistic-concurrency `version` + `ChangesetDto`, and the `ORG_*` error registry.
  - **F2** *Public Interface* (§10) — the `Property` tree and the **site-resolution seam** (`governingSiteId(device)` ⇒ `device.propertyId`, `subtreePropertyIds(propertyId)`, `isAtOrUnder(propertyId, ancestorId)`), `DeviceDto.propertyId`, and the interim **MEMBER-read-only / OWNER+ADMIN-mutate** posture that F3 replaces.
  - **F1b** *Public Interface* — the invitation flow. F3 does **not** re-implement invitations; it layers the *who-may-invite-and-at-what-role* authorization onto F1b (§7). If F1b is unbuilt when F3 lands, the invite-authorization rules attach to it then; nothing else in F3 blocks on F1b.
- **Downstream consumers:** **Spec 4** (nodes in 3D — scopes who may see/edit which nodes). Read only the *Public Interface* (§10).

---

## 1. Context

After F2 the network model is **located** (every `Device` sits at a `Property`) but access is still coarse: F2 shipped an interim posture where a MEMBER is read-only across the whole org and OWNER/ADMIN mutate **everything, org-wide**. F2 deliberately deferred "differentiated OWNER-vs-ADMIN levels and site-restricted admin scope" to F3 (F2 §3, §8).

F3 delivers the real model. A user's authority is the product of **two orthogonal axes**:

- **Role — *what* you may do.** The existing F1a `OrgRole` (`OWNER`/`ADMIN`/`MEMBER`) is a **verb ceiling**: MEMBER may *view*, ADMIN may *configure*, OWNER may configure everything and holds the org-level powers (billing, workspace deletion, user/role management).
- **Assignment — *where* you may do it.** A user sees and acts on **only the site subtrees assigned to them**; everything outside is invisible. Assignment is carried by **teams** (the reusable unit) and, for one-off grants, directly per member.

Effective authority = *your role's verb ceiling, applied within your assigned subtrees.* The OWNER is unscoped (the whole org) and is the only role exempt from assignment.

> **Note on the name.** Earlier planning called F3 "team × site × **verb**" after the NetBox object-permission shape (group × object-type × actions × constraints). During design the **verb axis collapsed into the role** — access is binary *view* vs *configure*, decided by role, not stored per grant — and grants are uniform across entity types within a site (§3). The filename keeps the historical slug; the model is **role × site-scoped assignment**.

## 2. Goals

1. **Two-axis authorization:** role = verb ceiling (`MEMBER` view / `ADMIN` configure / `OWNER` all + org powers); assignment = the site subtrees a user is scoped to.
2. **Teams** as the reusable assignment unit (a team is granted site subtrees and has members); **direct per-member assignment** for fine-grained one-offs.
3. **True site-scoped visibility *and* mutation:** every list, get, mutation, **and** realtime event filters to the caller's assigned subtrees — outside them, entities are invisible, not merely read-only.
4. **Delegated, escalation-safe user management:** OWNER manages any user, role, and assignment; ADMIN may invite and configure **members only**, and may grant them **any subset of the admin's own** assigned sites — never beyond.
5. **Shared-network scoping:** a network that spans sites shows each caller only the parts within their scope.
6. A clean **Public Interface** (§10) for Spec 4: the authorization seam, DTOs, error codes, events, endpoints.

## 3. Non-Goals (explicitly out of scope for F3)

- **Per-action verb granularity.** No separate `create`/`edit`/`delete` grants. "Configure" is all-or-nothing within scope, decided by role. (Revisit only if a real "edit-but-not-delete" need appears — §14.)
- **Per-object-type grants.** An assignment covers **all** entity types within its site subtree uniformly (devices, networks-as-seen-through-devices, connections, etc.). No "view devices but not circuits."
- **A second role dimension per team.** Role lives on the *person* (`OrganizationMember.role`), not per team. You cannot be an admin in one region and a viewer in another; to view a site it simply has to be in your assignment.
- **SSO/SAML, authentication changes** (Better Auth owns auth; F1a). **Pricing / tier-gating** (program-wide out of scope).
- **Cross-org sharing**; **changes to F2's tree / containment / naming rules.**

## 4. Data Model

Additive to `apps/api/prisma/schema.prisma`. All new models are org-scoped and follow F1a conventions (repository-only access, `version` where mutable, `ChangeLog` audit, org-room events). **No change to `OrganizationMember.role`** — the role axis already exists.

### 4.1 `Team` — the reusable assignment unit

```prisma
model Team {
  id              String   @id @default(uuid())
  organizationId  String
  name            String
  creatorMemberId String?  // OrganizationMember (owner or admin) who created it; null ⇒ owner-managed only (e.g. the creator was removed)
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  organization Organization        @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  creator      OrganizationMember? @relation("TeamCreator", fields: [creatorMemberId], references: [id], onDelete: SetNull)
  members      TeamMember[]
  properties   TeamProperty[]

  @@index([organizationId])
  @@index([creatorMemberId])
}
```

Org-unique, case-insensitive `name` via a raw-SQL functional index (F2 §4.7 precedent):
```sql
CREATE UNIQUE INDEX team_org_name_lower_uniq ON "Team" ("organizationId", lower("name"));
```
Add `teams Team[]` back-relation to `Organization`.

### 4.2 `TeamMember` — member ↔ team (M2M)

```prisma
model TeamMember {
  id             String   @id @default(uuid())
  organizationId String
  teamId         String
  memberId       String   // → OrganizationMember.id
  createdAt      DateTime @default(now())

  team         Team               @relation(fields: [teamId], references: [id], onDelete: Cascade)
  member       OrganizationMember @relation(fields: [memberId], references: [id], onDelete: Cascade)
  organization Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([teamId, memberId])
  @@index([organizationId])
  @@index([memberId])
}
```

### 4.3 `TeamProperty` — team → assigned site-subtree root (M2M)

Mirrors F2's `NetworkProperty`. `propertyId` is the **root of an assigned subtree** — by §5 it covers that node and all descendants (`subtreePropertyIds`).

```prisma
model TeamProperty {
  id             String   @id @default(uuid())
  organizationId String
  teamId         String
  propertyId     String
  createdAt      DateTime @default(now())

  team         Team         @relation(fields: [teamId], references: [id], onDelete: Cascade)
  property     Property     @relation(fields: [propertyId], references: [id], onDelete: Restrict)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([teamId, propertyId])
  @@index([organizationId])
  @@index([propertyId])
}
```

### 4.4 `MemberProperty` — direct per-member assignment (the one-off path)

For fine-grained delegation ("give *this* member exactly *these* sites") without forcing a single-person team. Composes with team assignments by union (§5).

```prisma
model MemberProperty {
  id             String   @id @default(uuid())
  organizationId String
  memberId       String   // → OrganizationMember.id
  propertyId     String
  createdAt      DateTime @default(now())

  member       OrganizationMember @relation(fields: [memberId], references: [id], onDelete: Cascade)
  property     Property           @relation(fields: [propertyId], references: [id], onDelete: Restrict)
  organization Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([memberId, propertyId])
  @@index([organizationId])
  @@index([propertyId])
}
```

Add the matching back-relations to `OrganizationMember` (`teamMemberships TeamMember[]`, `siteAssignments MemberProperty[]`, `createdTeams Team[] @relation("TeamCreator")`) and `Property` (`teamAssignments TeamProperty[]`, `memberAssignments MemberProperty[]`).

### 4.5 `onDelete` posture

| Relation | Behavior |
|---|---|
| `TeamMember`/`TeamProperty` → `Team` | `Cascade` (deleting a team clears its memberships + assignments) |
| `TeamMember`/`MemberProperty` → `OrganizationMember` | `Cascade` (removing a member clears their memberships + direct assignments) |
| `TeamProperty`/`MemberProperty` → `Property` | `Restrict` (a site assigned to anyone cannot be deleted out from under the grant; clear the assignment first → `PERM_005`) |
| any F3 model → `Organization` | `Cascade` (org deletion cascades, per F1a) |

The `Restrict` on `Property` extends F2 §5's "delete blocked if subtree non-empty" — a site that is **assigned** (directly or via a team) is also non-empty for delete purposes.

## 5. The Authorization Model

**Effective assigned roots** of a member *m* (the set of subtree-root property ids that scope them):
```
effectiveRoots(m) = { tp.propertyId | tp ∈ TeamProperty, tp.team ∈ teamsOf(m) }
                  ∪ { mp.propertyId | mp ∈ MemberProperty, mp.member = m }
```
Multiple teams / direct grants **union** (most-permissive). An OWNER has no `effectiveRoots` gate — they are unscoped.

**In-scope test** for an entity with governing site `s = governingSiteId(entity)` (F2 §10.2):
```
inScope(m, s) = ∃ root ∈ effectiveRoots(m) : isAtOrUnder(s, root)
```

**The decision function** (the single rule, evaluated in the repository layer):
```
authorize(user, entity, action):
  if user.role == OWNER:            return ALLOW          # unscoped, all verbs, all org powers
  if not inScope(user, governingSiteId(entity)):
                                    return INVISIBLE      # 404 on read, PERM_001 on write
  if action == VIEW:                return ALLOW          # MEMBER and ADMIN both view in scope
  if action == CONFIGURE:           return user.role == ADMIN ? ALLOW : DENY(ORG_003)
```

- **MEMBER:** view within scope; any mutation → `ORG_003` (role denies all mutation, as in F2).
- **ADMIN:** view + configure within scope; configure outside scope → `PERM_001`.
- **OWNER:** everything, everywhere.
- **Governing site of non-device entities** (so the one rule covers the whole model):
  - `Property` node → **itself** (you may see/configure a site iff it is at/under one of your roots). Creating a child under an in-scope node is in scope; a **new top-level `SITE`** (`parentId = null`) is under no existing root, so **only the OWNER can create top-level sites** — this falls out of the rule, no special case.
  - `Device` → `device.propertyId` (the F2 anchor).
  - `Network` → **set-valued** (its charters + devices span sites); see §6 shared-network rules.
  - `DeviceConnection` / `FiberRun` / `Circuit` → the sites of their **endpoint devices**; see §6.

## 6. Enforcement (extending the F1a/F2 seam)

F3 wraps F1a's repository-scoping convention exactly as F2 §10.2 anticipated: *"…and the entity's `governingSiteId` ∈ the caller's assigned subtree."* The repository layer is the single chokepoint — no query bypasses it.

- **Reads (list/get):** every site-bound query is filtered to `governingSiteId ∈ subtreeOf(effectiveRoots(user))`. Out-of-scope rows never appear in lists; a direct `GET` of an out-of-scope entity returns **404** (invisible, not "forbidden" — never leak existence). OWNER skips the filter.
- **Writes:** the §5 decision runs before any mutation. MEMBER write → `ORG_003`; in-org but out-of-scope ADMIN write → `PERM_001` (403).
- **Shared networks (the confirmed scoped view):** a network may be chartered to / have devices across several sites (F2: the device is the network×site junction).
  - **Visibility:** a `Network` is visible to *m* if **any** of its charters or placed devices is `inScope(m, ·)`. *m* then sees **only** the in-scope devices and in-scope charters of that network; out-of-scope devices/charters are masked entirely (consistent with "only your own sites").
  - **Device-level configure:** scoped per device (`device.propertyId` in scope) — an ADMIN may edit the in-scope devices of a partially-visible network.
  - **Network-level configure** (rename/delete the `Network`; add/remove a charter): requires **every** chartered site of that network to be in the caller's scope (OWNER always). A partial-scope admin must not reshape a network reaching sites they can't see → `PERM_004`. Creating a network and chartering it only to in-scope sites is allowed.
  - **`DeviceConnection`/`FiberRun`/`Circuit` (inter-site links):** **visible if *either* endpoint's site is in scope** — an inter-site link is shared infrastructure, so both sides see it. The in-scope endpoint shows in full; the **far (out-of-scope) endpoint is shown as an identity reference** (id + name + its site name — no deeper access into that site). **Create/edit/delete** a link requires **both** endpoint sites in scope (you must be able to see both devices to wire or reshape them) or OWNER → else `PERM_001`. A same-site link (both ends under one in-scope site) is fully view + configure as normal.
- **No client trust:** scope is derived from the session's `OrganizationMember`, never from the request. A foreign `propertyId`/`teamId`/`memberId` in a payload is ignored/validated against scope → `ORG_008`/`PERM_001`.

## 7. Delegated User & Assignment Management

Who may manage whom, and assign what. All of this is enforced server-side.

- **OWNER:** invite and configure **any** user; set/change **any** role (incl. promoting to ADMIN/OWNER); create/edit/delete teams; assign **any** site subtree to any team or member; manage billing; delete the workspace.
- **ADMIN:** may invite and configure **MEMBERS only** (never other admins or the owner; **cannot change anyone's role** — promotion is OWNER-only → `PERM_003`). **May create and fully manage the teams they create** (`Team.creatorMemberId = self`): rename/delete them, **assign them any sites ⊆ the admin's own `effectiveRoots`** (beyond → `PERM_002`), and add/remove **members** (non-member target → `PERM_003`). May also grant a member directly (`MemberProperty`, ⊆ own scope) and add/remove members on **any** team whose assignments are wholly ⊆ their scope. May **not** rename/delete/re-assign a team they did **not** create (→ `PERM_003`), nor create **top-level sites** or set the **org naming policy** — those stay **OWNER-only**. May create sub-sites under assigned sites (§5).
- **MEMBER:** no user, team, or assignment management.

**Escalation-safety invariants** (tested, §12):
1. An admin can only grant access that is a **subset of what the admin holds** (`PERM_002` otherwise) — so delegation can never widen the grantor's own reach.
2. An admin can only target **members** (`PERM_003` for any attempt on an admin/owner, or any role change).
3. **In-scope slice rule:** when an admin manages a member who *also* holds sites outside the admin's scope (granted by the owner or another admin), the admin sees and may modify **only the portion within the admin's own scope**; the out-of-scope assignments are invisible and untouchable to that admin.

## 8. Realtime (site-scoped fan-out)

F2 broadcast every entity event to the whole `org:{organizationId}` room. That would leak out-of-scope activity, so F3 **filters the fan-out**:

- The gateway keeps the single `org:{organizationId}` room (no per-site room explosion) and, for **site-bound** events, emits only to sockets whose user is `inScope` of the event's `governingSiteId` (OWNER always receives). The check reuses §5 (`isAtOrUnder` over the socket's cached `effectiveRoots`).
- **Network/charter/link events** follow the §6 visibility rule (a socket gets the event if the network/link is visible to it; device sub-events are filtered per device site).
- A socket's `effectiveRoots` are resolved at connection time and **re-resolved when the user's teams/assignments/role change** (a `v1:access:changed` event tells the client to refetch `GET /v1/access/me` and re-scope its UI).

## 9. Migration (greenfield)

Pre-launch, no production data (per the roadmap). The Prisma migration adds `Team`, `TeamMember`, `TeamProperty`, `MemberProperty`, the case-insensitive `team_org_name_lower_uniq` index, and the back-relations. **No data backfill.** It does **not** alter `OrganizationMember`. F2's interim guard posture (§8 of F2: mutations gated `OWNER`/`ADMIN` org-wide) is **replaced** by the §5/§6 scoped enforcement — the implementation plan must migrate every mutation/list path from the coarse guard to the scoped check, and seed scripts gain sample teams, assignments, and a scoped-admin + member fixture for tests.

## 10. Public Interface (the contract downstream specs cite)

Downstream specs (Spec 4) read **only this section**.

### 10.1 Shared DTOs (`packages/shared`, derived from Prisma)
- `TeamDto { id, organizationId, name, version, createdAt, updatedAt }`
- `TeamMemberDto { id, teamId, memberId }`
- `TeamPropertyDto { id, teamId, propertyId }`
- `MemberPropertyDto { id, memberId, propertyId }`
- `AccessSummaryDto { role: OrgRole, assignedRootPropertyIds: string[], unscoped: boolean }` — the caller's effective scope, for the client to scope its own UI (`unscoped: true` for OWNER).

### 10.2 Authorization seam (what the API and Spec 4 call)
Exposed by a `PermissionsService` layered on F2's `PropertiesService`:
- `effectiveRoots(memberId): string[]` ⇒ union of team + direct assignments (∅-gate skipped for OWNER).
- `inScope(memberId, propertyId): boolean` ⇒ `∃ root : isAtOrUnder(propertyId, root)` (F2 §10.2).
- `assertCanView(user, entity)` / `assertCanConfigure(user, entity)` ⇒ the §5 decision; throws `NodeScopeException` with the codes below.
- `scopeFilter(memberId): { propertyIdIn: string[] }` ⇒ the precomputed in-scope property-id set repositories `AND` into every site-bound query.

### 10.3 Error codes (register in the API Design Document before implementing)
- `PERM_001 OUTSIDE_ASSIGNED_SCOPE` (403) — in-org mutation on an entity outside the caller's scope. (Reads are **404**, never `PERM_001`.)
- `PERM_002 SCOPE_EXCEEDS_GRANTOR` (403) — admin tried to assign sites beyond their own `effectiveRoots`.
- `PERM_003 CANNOT_MANAGE_TARGET` (403) — admin tried to manage a non-member (admin/owner) or change a role.
- `PERM_004 NETWORK_PARTIAL_SCOPE` (403) — network-level op without full coverage of the network's chartered sites.
- `TEAM_001 TEAM_NOT_FOUND` (404) · `TEAM_002 TEAM_NAME_TAKEN` (409, case-insensitive org-unique).
- `PERM_005 PROPERTY_ASSIGNED` (409) — delete blocked because the site is assigned (extends F2 `PROP_004`).
- Reuse F1a: `ORG_003` (MEMBER attempts a mutation), `ORG_008` (cross-org), optimistic-concurrency version conflict.

### 10.4 WebSocket events (room `org:{organizationId}`, filtered per §8)
- `v1:team:created` / `v1:team:updated` / `v1:team:deleted`
- `v1:team:member:added` / `v1:team:member:removed`
- `v1:team:property:assigned` / `v1:team:property:unassigned`
- `v1:member:property:assigned` / `v1:member:property:unassigned`
- `v1:access:changed` (payload: affected `memberId`) — tells that user's sockets to refetch `GET /v1/access/me`.
- All **existing** F1a/F2 entity events are now **scope-filtered** rather than org-wide.

### 10.5 Endpoints
Authorization per §7 (OWNER full; ADMIN members-only within own scope; reads are scope-filtered).
- **Teams** *(`GET` scope-filtered; `POST` OWNER or ADMIN; `PATCH`/`DELETE` OWNER or the creating ADMIN)*: `GET /v1/teams` · `GET /v1/teams/:id` · `POST /v1/teams` · `PATCH /v1/teams/:id` (`baseVersion`) · `DELETE /v1/teams/:id`
- **Team members** *(OWNER any; ADMIN on teams they created, or any team wholly ⊆ own scope; members only)*: `POST /v1/teams/:id/members` · `DELETE /v1/teams/:id/members/:memberId`
- **Team site assignment** *(OWNER any; ADMIN on teams they created, sites ⊆ own scope → else `PERM_002`)*: `POST /v1/teams/:id/properties` · `DELETE /v1/teams/:id/properties/:propertyId`
- **Direct member assignment** *(OWNER any; ADMIN ⊆ own scope, members only)*: `GET /v1/members/:memberId/access` · `POST /v1/members/:memberId/properties` · `DELETE /v1/members/:memberId/properties/:propertyId`
- **Self:** `GET /v1/access/me` ⇒ `AccessSummaryDto`
- **Invite authorization** (overlays F1b's invitation endpoint): ADMIN may create invitations at role `MEMBER` only and within own scope; OWNER any role → `PERM_003` otherwise.
- **All existing F1a/F2 `GET`/mutation endpoints** are now scope-filtered/checked per §5–§6 (replacing F2's coarse `@OrgRoles('OWNER','ADMIN')` mutation gate).

## 11. Security Considerations

- **Repository-layer chokepoint:** the §5 decision and `scopeFilter` live in repositories; no service or controller can issue an unscoped site-bound query. This is the same seam F1a/F2 established.
- **Invisible, not forbidden:** out-of-scope reads 404 and surface nothing about the entity's existence; only deliberate mutations return a `PERM_*` 403. Cross-org remains `ORG_008` and is logged.
- **No self-escalation:** §7 invariants are enforced server-side and tested — an admin cannot grant beyond their scope (including via teams they author — every team assignment is re-checked ⊆ the admin's scope), manage a higher role, change roles, or restructure teams they didn't create.
- **Realtime parity:** the §8 filter mirrors the read filter, so a user can never receive an event for a site they can't query.
- **Audit:** all team/assignment CRUD writes `ChangeLog` (`entityType` `'Team'`/`'TeamMember'`/`'TeamProperty'`/`'MemberProperty'`), including the actor and the affected member, so delegation is fully traceable.

## 12. Testing (TDD — test first)

- **Scope (read):** a member assigned site A sees devices/properties at/under A and **not** those under unassigned B (absent from lists; direct GET → 404). Union across two teams / a team + direct grant.
- **Scope (write):** ADMIN configures in-scope device (ok); out-of-scope device → `PERM_001`; MEMBER any mutation → `ORG_003`; OWNER everywhere (ok).
- **Verb ceiling:** MEMBER view-only in scope; ADMIN view+configure in scope; top-level `SITE` create → only OWNER; sub-site under an assigned site → ADMIN ok.
- **Delegation / escalation:** admin grants member ⊆ own scope (ok); admin grants beyond own scope → `PERM_002`; admin targets an admin/owner or changes a role → `PERM_003`; admin invites at `MEMBER` (ok) / at `ADMIN` → `PERM_003`; in-scope-slice rule — admin sees/edits only the in-scope part of a member who also holds out-of-scope sites.
- **Admin-authored teams:** admin creates a team + assigns sites ⊆ own scope (ok); assigns a site beyond scope → `PERM_002`; admin renames/deletes a team **they created** (ok) but another admin's or the owner's team → `PERM_003`; admin adds a member to an in-scope team (ok).
- **Shared network:** partially-scoped network shows only in-scope devices/charters; device edit in scope ok; network rename/charter without full coverage → `PERM_004`.
- **Inter-site link:** a link is visible from *either* endpoint's site; the far out-of-scope endpoint appears as an identity reference only; create/edit/delete from a single-ended ADMIN → `PERM_001`; both-ends (or OWNER) succeeds.
- **Realtime:** an event for site B is **not** delivered to a socket scoped to A; `v1:access:changed` fires on assignment/role change; OWNER receives all.
- **Delete guard:** deleting an assigned site → `PERM_005`; clearing the assignment then deleting succeeds.
- **Isolation/audit:** cross-org team/member ids → `ORG_008`; team/assignment CRUD writes `ChangeLog` with actor + affected member.

## 13. Documentation (Rule 10 — same-commit doc updates)

- Add `TEAM_001`–`TEAM_002`, `PERM_001`–`PERM_005`, and the `v1:team:*` / `v1:member:property:*` / `v1:access:changed` events to the **API Design Document** before implementation; note that all prior site-bound events are now scope-filtered.
- Update the SAD: the role × assignment model, teams + direct assignment, the repository scope filter, the shared-network scoped view, and the realtime fan-out filter (superseding F2's MEMBER-read-only posture).
- Update CLAUDE.md module docs: permissions are now site-scoped via the Property tree; the F2 `OWNER`/`ADMIN` mutation guard is replaced by the scoped check.

## 14. Open Questions (non-blocking; resolve during writing-plans / implementation)

- **Direct `MemberProperty` vs teams-only:** if scoped teams prove sufficient in practice, the direct per-member path (§4.4) could be dropped to a single mechanism. Kept for now because fine-grained admin delegation (and admin-authored teams) make per-member grants useful.
- **Inter-site link mutation + far-endpoint detail:** *visibility* is settled — a link is visible from **either** endpoint's site (user decision). Open: (a) exactly which far-endpoint reference fields are safe to expose (currently id + name + site name); (b) whether **create/edit/delete** should keep requiring **both** ends (current) or be allowed from a single end since the link is shared.
- **`scopeFilter` performance:** for deep trees, whether to materialize `subtreePropertyIds` (closure table / `ltree`) vs. recursive CTE per request; revisit if the recursive resolution is hot.
- **Owner count:** whether an org may have more than one OWNER (today's enum allows it; billing/delete implications) — confirm during F1b/owner-management work.
- **Assignment granularity below `AREA`:** assignments are at any `Property` node; no per-device assignment is planned (devices inherit via their site). Confirm that's sufficient.
