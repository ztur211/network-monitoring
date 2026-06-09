# F1b — Membership Growth (Invitations, Join Requests, Member Management)

- **Status:** Draft for review
- **Date:** 2026-06-06
- **Spec:** F1b (second of the foundation layer)
- **Depends on:** F1a (tenancy models, `OrganizationsRepository`, `OrgContextGuard`, `@OrgId`, `@OrgRoles`, `SuperAdminGuard`, error codes `ORG_001`–`ORG_008`)
- **Downstream consumers:** none structurally — F2/F3/Spec 1 depend only on F1a. F1b makes orgs self-grow.

---

## 1. Context

After F1a, an organization exists and a NodeScope operator can seed its first OWNER, but the org cannot grow its own team. F1b adds the two member-acquisition paths chosen during brainstorming — **admin invitations** and **domain-matched request-to-join** — plus **member management** (role changes and removal) with a clear authority model and last-owner protection.

F1b is purely additive on top of F1a: two new models, a handful of endpoints, and new error codes. It does not touch the spatial/3D work or the permission engine (F3).

## 2. Goals

1. OWNER/ADMIN can invite a person by email + role; the API returns a shareable tokenized link (no email-infra dependency).
2. An invitee accepts by signing in with the **matching email** and submitting the token, creating their membership at the invited role.
3. A signed-in user whose email domain maps to an org can request to join; OWNER/ADMIN approve (→ MEMBER) or deny; denied users may re-request.
4. OWNER/ADMIN can change a member's role and remove members, under a fixed authority model, and the last OWNER is protected.
5. All flows respect one-org-per-user and derive the actor/org from the session, never the client.

## 3. Non-Goals

- Email delivery of invites (link is returned; email can layer on later).
- SSO/SCIM auto-provisioning (F1a non-goal; still out).
- Self-service org creation (orgs are operator-provisioned — F1a).
- Sites, permissions, spatial/3D (F2/F3/Spec 1+).
- Leaving an org / ownership transfer UX (deferred; only admin-initiated removal here, with last-owner protection).

## 4. Data Model

Additive to `apps/api/prisma/schema.prisma`.

```prisma
enum JoinRequestStatus {
  PENDING
  APPROVED
  DENIED
}

model Invitation {
  id              String   @id @default(uuid())
  organizationId  String
  email           String                       // stored lowercased
  role            OrgRole  @default(MEMBER)
  token           String   @unique
  expiresAt       DateTime
  invitedByUserId String?
  acceptedAt      DateTime?
  createdAt       DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([email])
}

model JoinRequest {
  id              String            @id @default(uuid())
  organizationId  String
  userId          String
  status          JoinRequestStatus @default(PENDING)
  decidedByUserId String?
  decidedAt       DateTime?
  createdAt       DateTime          @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([organizationId, status])
  @@index([userId])
}
```

Add the back-relations to `Organization` (`invitations Invitation[]`, `joinRequests JoinRequest[]`) and to `User` (`joinRequests JoinRequest[]`). No optimistic-concurrency `version` on these (they are short-lived workflow records, not edited concurrently).

**Uniqueness handled in the service, not the schema:**
- One *pending* invite per `(organizationId, lower(email))` — re-inviting replaces the prior pending token.
- One *pending* `JoinRequest` per `userId`.

## 5. Invitation Flow

1. **Create** (OWNER/ADMIN): `POST /v1/organizations/me/invitations { email, role }`. Service lowercases the email, deletes any existing pending invite for that `(org, email)`, generates a secure random `token`, sets `expiresAt = now + 7 days`, records `invitedByUserId` from the session. Returns the invite + a **shareable link** (`{appUrl}/invite/{token}` — the API returns the token; the frontend renders the accept page).
2. **List / revoke** (OWNER/ADMIN): `GET /v1/organizations/me/invitations` (pending only); `DELETE /v1/organizations/me/invitations/:id` (revoke).
3. **Accept** (authenticated user, not yet in an org): `POST /v1/invitations/accept { token }`.
   - `ORG_009 INVITATION_INVALID` if the token is unknown, already accepted, revoked, or expired.
   - `ORG_010 INVITATION_EMAIL_MISMATCH` if `session.user.email !== invitation.email`.
   - `ORG_011 ALREADY_A_MEMBER` if the user already has an `OrganizationMember`.
   - Otherwise: create `OrganizationMember(userId, organizationId, role)`, set `invitation.acceptedAt`, emit `v1:org:member:added` + `v1:org:invitation:accepted` to the org room.

## 6. Request-to-Join Flow

1. **Submit** (authenticated user, not in an org): `POST /v1/join-requests`. Service resolves the org from the user's email domain via `OrganizationDomain`.
   - `ORG_011 ALREADY_A_MEMBER` if the user already belongs to an org.
   - `ORG_014 NO_MATCHING_ORG_FOR_DOMAIN` if no org claims the domain.
   - `ORG_015 DUPLICATE_JOIN_REQUEST` if the user already has a PENDING request.
   - Otherwise create `JoinRequest(PENDING)`, emit `v1:org:joinRequest:created` to the org room.
2. **List** (OWNER/ADMIN): `GET /v1/organizations/me/join-requests?status=PENDING`.
3. **Decide** (OWNER/ADMIN): `POST /v1/organizations/me/join-requests/:id/approve` or `/deny`.
   - `ORG_012 JOIN_REQUEST_INVALID` if not found / not in this org / not PENDING.
   - Approve: set `status=APPROVED`, `decidedByUserId`/`decidedAt`; create `OrganizationMember(userId, org, MEMBER)` (guard `ORG_011` if the user joined elsewhere meanwhile); emit `v1:org:member:added` + `v1:org:joinRequest:decided`.
   - Deny: set `status=DENIED`, `decidedBy/At`; emit `v1:org:joinRequest:decided`. The user may submit a new request later (no block).

## 7. Member Management & Authority Model

Endpoints (OWNER/ADMIN, via `@OrgRoles`):
- `PATCH /v1/organizations/me/members/:userId { role }` — change role.
- `DELETE /v1/organizations/me/members/:userId` — remove member.

**Authority model** (enforced in the service, keyed off the actor's role and the target's current role):
- **OWNER** may manage any member (OWNER/ADMIN/MEMBER) and may set any role.
- **ADMIN** may manage only **MEMBER** targets and may only set the role to MEMBER (cannot create or touch ADMIN/OWNER).
- Any violation → `ORG_003 INSUFFICIENT_ORG_ROLE`.

**Last-owner protection:** demoting or removing a member who is the org's **only** OWNER → `ORG_013 LAST_OWNER_PROTECTED`.

Emit `v1:org:member:updated` (role change) or `v1:org:member:removed` (removal) to the org room.

## 8. Public Interface

### 8.1 Shared DTOs (`packages/shared`, plain interfaces)
- `InvitationDto { id, email, role, expiresAt, acceptedAt, createdAt }`
- `InvitationLinkDto { invitation: InvitationDto, token: string, url: string }`
- `JoinRequestDto { id, organizationId, userId, status, createdAt, decidedAt }`

### 8.2 Error codes (register in the API Design Document before implementing)
- `ORG_009 INVITATION_INVALID` (404)
- `ORG_010 INVITATION_EMAIL_MISMATCH` (403)
- `ORG_011 ALREADY_A_MEMBER` (409)
- `ORG_012 JOIN_REQUEST_INVALID` (404)
- `ORG_013 LAST_OWNER_PROTECTED` (409)
- `ORG_014 NO_MATCHING_ORG_FOR_DOMAIN` (404)
- `ORG_015 DUPLICATE_JOIN_REQUEST` (409)
- (Reuse `ORG_003 INSUFFICIENT_ORG_ROLE` for authority violations.)

### 8.3 WebSocket events (constants in `realtime.types.ts`; room `org:{organizationId}`)
- `v1:org:invitation:created`, `v1:org:invitation:revoked`, `v1:org:invitation:accepted`
- `v1:org:joinRequest:created`, `v1:org:joinRequest:decided`
- (`v1:org:member:added/updated/removed` already exist from F1a.)

### 8.4 Endpoints
- Org-scoped (AuthGuard + OrgContextGuard + OrgRoleGuard OWNER/ADMIN): the invitations, join-requests (list/decide), and members endpoints above.
- Non-org-scoped (AuthGuard only — the actor isn't a member yet): `POST /v1/invitations/accept`, `POST /v1/join-requests`.

## 9. Security Considerations

- The accepting actor and their email come from the **session**, never the body — email match is checked against `session.user.email`.
- Tokens are cryptographically random and single-use (consumed by `acceptedAt`); expired/used tokens fail with `ORG_009`.
- Authority and last-owner checks are server-side in the service; a frontend gate is not a gate.
- Join requests resolve the org from the requester's verified-by-operator domain mapping, not from a client-supplied org id.
- One-org-per-user (`OrganizationMember.userId @unique`) is enforced at both the DB and service layers (`ORG_011`).

## 10. Testing (TDD)

- **Invitation:** create replaces a prior pending invite; accept with matching email succeeds and creates the membership; wrong email → `ORG_010`; expired/used/unknown token → `ORG_009`; already-a-member → `ORG_011`; revoke makes a token unusable.
- **Join request:** submit resolves org by domain; no domain match → `ORG_014`; duplicate pending → `ORG_015`; approve creates a MEMBER and marks APPROVED; deny marks DENIED and allows a fresh request.
- **Member management:** OWNER can change any role; ADMIN managing an ADMIN/OWNER → `ORG_003`; demote/remove the only OWNER → `ORG_013`; happy-path role change + removal emit the right events.
- **Isolation:** all queries scoped to the session org; a foreign org id in a payload is ignored.

## 11. Documentation (Rule 10)

- Register `ORG_009`–`ORG_015` and the new WS events in the API Design Document.
- Note the invitation/join-request flows in the SAD multi-tenancy section.

## 12. Open Questions (non-blocking)

- Invite link base URL (`appUrl`) source — config/env; confirm the existing config key during implementation.
- Whether to expose a member's email/name in `OrganizationMemberDto` for the roster UI (a join to `User`); decide when the member-management UI is built
