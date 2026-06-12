# NodeScope — Consolidated API Reference (forward-design)

The single index every spec's "Documentation (Rule 10)" section points at ("register in the API Design Document"): all **error codes**, **REST endpoints**, and **WebSocket events** introduced across the 13 forward-designed features (F1a–F3, Spec 1–9), on `share/local-docs`. Generated from the specs + plans; **0 of 13 built**, so this is the *intended* surface, the contract to honor while building.

Conventions: every mutating list/get/write is org-scoped (org derived from the session, never the client) and, from F3 on, **site-scoped** via `PermissionsService`. Reads of out-of-scope entities are **404 (invisible, not forbidden)**; deliberate out-of-scope mutations are **403** (`PERM_001`). The `{ success, data, timestamp }` envelope wraps JSON responses; file routes (`export/ifc`, `bcf/export`) stream raw with `@Res()`. Optimistic concurrency uses `ChangesetDto.baseVersion` → **409** on mismatch.

---

## 1. Error codes

| Code | Name | HTTP | Origin |
|---|---|---|---|
| `ORG_001` | ORGANIZATION_NOT_FOUND | 404 | F1a |
| `ORG_002` | NOT_AN_ORG_MEMBER | 403 | F1a |
| `ORG_003` | INSUFFICIENT_ORG_ROLE (MEMBER attempted a mutation) | 403 | F1a |
| `ORG_004` | DOMAIN_ALREADY_CLAIMED | 409 | F1a |
| `ORG_005` | DEVICE_NAME_TAKEN | 409 | F1a |
| `ORG_006` | NAMING_POLICY_VIOLATION | 422 | F1a |
| `ORG_007` | SUPERADMIN_REQUIRED | 403 | F1a |
| `ORG_008` | CROSS_ORG_ACCESS_DENIED | 403/404 | F1a |
| `ORG_009`–`ORG_015` | INVITATION_INVALID · INVITATION_EMAIL_MISMATCH · ALREADY_A_MEMBER · JOIN_REQUEST_INVALID · LAST_OWNER_PROTECTED · NO_MATCHING_ORG_FOR_DOMAIN · DUPLICATE_JOIN_REQUEST | 4xx | F1b |
| `PROP_001`–`PROP_008` | PROPERTY_NOT_FOUND(404) · INVALID_PARENT_TYPE · PROPERTY_NAME_TAKEN(409) · PROPERTY_NOT_EMPTY(409) · PROPERTY_CYCLE(422) · CHARTER_EXISTS(409) · DEVICE_NOT_IN_CHARTERED_SITE(422) · CHARTER_IN_USE(409) | 4xx | F2 |
| `TEAM_001`–`TEAM_002` | TEAM_NOT_FOUND(404) · TEAM_NAME_TAKEN(409) | 4xx | F3 |
| `PERM_001`–`PERM_005` | OUTSIDE_ASSIGNED_SCOPE(403) · SCOPE_EXCEEDS_GRANTOR(403) · CANNOT_MANAGE_TARGET(403) · NETWORK_PARTIAL_SCOPE(403) · PROPERTY_ASSIGNED(409) | 4xx | F3 |
| `MODEL_001`,`002`,`004`–`008` | BUILDING_MODEL_NOT_FOUND(404) · PROPERTY_NOT_BUILDING(422) · MODEL_VERSION_NOT_FOUND(404) · CANNOT_DELETE_ACTIVE_VERSION(409) · MODEL_FILE_TOO_LARGE(413) · INVALID_IFC_FILE(422) · BUILDING_HAS_MODEL(409) | 4xx | Spec 1 |
| `SPATIAL_001`–`SPATIAL_002` | DEVICE_NOT_IN_MODELED_BUILDING(422) · INCOMPLETE_POSITION(422) | 422 | Spec 1 |
| `DAUTH_001`–`DAUTH_003` | INVALID_REDIRECT_URI · CODE_INVALID_OR_EXPIRED · PKCE_VERIFICATION_FAILED | 4xx | Spec 2 |
| `AGENT_001` | INVALID_ENROLLMENT_CODE | 401 | Spec 8 |
| `SNMP_001`–`SNMP_003` | CREDENTIAL_NOT_FOUND(404) · OID_PROFILE_NOT_FOUND(404) · SNMP_RESOURCE_ASSIGNED(409) | 4xx | Spec 9 |
| `BCF_001`–`BCF_005` | ARCHIVE_TOO_LARGE(413) · INVALID_SNAPSHOT(422) · MALFORMED_ARCHIVE(422) · TOPIC_NOT_FOUND(404) · VERSION_CONFLICT(409) | 4xx | Spec 6 |

*No new monitoring codes — Spec 7's ingest reuses `ORG_008` for cross-org `deviceId`. Spec 3/4/5 add no codes (reuse `MODEL_001`, `ORG_003`/`PERM_001`, `PROP_001`).*

---

## 2. REST endpoints (`/v1`)

**Org & admin (F1a):** `POST /admin/organizations` · `POST /admin/organizations/:id/{domains,owner}` · `GET|PATCH /organizations/me` · `GET /organizations/me/members` · `PATCH|DELETE /organizations/me/members/:userId`
**Membership (F1b):** `GET|POST|DELETE /organizations/me/invitations[/:id]` · `POST /invitations/accept` · `GET /organizations/me/join-requests` · `POST /join-requests` · `POST /organizations/me/join-requests/:id/approve`
**Sites (F2):** `GET|POST /properties` · `GET|PATCH|DELETE /properties/:id` · `GET|POST /networks/:id/properties` · `DELETE /networks/:id/properties/:propertyId`
**Devices (F2/Spec1/Spec4):** `GET|POST /devices` · `GET /devices?buildingPropertyId=` (Spec 4) · `PATCH /devices/:id` · `PATCH /devices/:id/position` (Spec 1) · `GET /devices/name-suggestion` (F2)
**Permissions (F3):** `GET|POST /teams` · `GET|PATCH|DELETE /teams/:id` · `POST|DELETE /teams/:id/members[/:memberId]` · `POST|DELETE /teams/:id/properties[/:propertyId]` · `GET|POST /members/:memberId/{access,properties}` · `DELETE /members/:memberId/properties/:propertyId` · `GET /access/me`
**Building model (Spec 1):** `GET /buildings/:propertyId/model` · `GET /buildings/:propertyId/model/versions` · `POST /buildings/:propertyId/model/versions` · `PUT /buildings/:propertyId/model/active` · `GET /buildings/:propertyId/model/{versions/:versionId/file,active/file}` · `DELETE /buildings/:propertyId/model/versions/:versionId`
**Desktop auth (Spec 2):** `GET /desktop-auth/authorize` · `POST /desktop-auth/{token,revoke}`
**IFC export (Spec 5):** `GET /buildings/:propertyId/export/ifc`
**Monitoring (Spec 7):** `GET /buildings/:propertyId/device-status` · `GET /devices/:id/metrics?metric&from&to&bucket` · `POST /monitoring/ingest` (org or agent token) · `POST /monitoring/ingest-token` (OWNER)
**Agent (Spec 8):** `GET /agents` · `POST /agents/enrollment-code` · `POST /agents/:id/revoke` · `DELETE /agents/:id` · `POST /monitoring/agent/enroll` · `GET /monitoring/agent/devices` · `POST /monitoring/agent/heartbeat`
**SNMP (Spec 9):** `POST|GET /snmp/credentials` · `DELETE /snmp/credentials/:id` · `POST /snmp/oid-profiles` (+ GET/PATCH/DELETE) · `POST /snmp/assign` · assignment also via `PATCH /networks/:id` + `PATCH /devices/:id`
**BCF (Spec 6):** `POST /buildings/:propertyId/bcf/import` · `GET /buildings/:propertyId/bcf/export` · `GET /buildings/:propertyId/bcf/topics` · `POST /buildings/:propertyId/bcf/topics` · `GET|PATCH /bcf/topics/:id` · `POST /bcf/topics/:id/comments`

*No path collisions. Canonicalize the building path param to `:propertyId` (a couple of specs wrote `:id` for `device-status`/`export/ifc` — same route).*

---

## 3. WebSocket events (room `org:{organizationId}`, F3 scope-filtered from F3 on)

- **Org/membership (F1a/F1b):** `v1:org:updated` · `v1:org:member:{added,removed,updated}` · `v1:org:invitation:{created,accepted,revoked}` · `v1:org:joinRequest:{created,decided}`
- **Sites (F2):** `v1:property:{created,updated,deleted,moved}` · `v1:network:charter:{added,removed}`
- **Permissions (F3):** `v1:team:{created,updated,deleted}` · `v1:team:member:{added,removed}` · `v1:team:property:{assigned,unassigned}` · `v1:member:property:{assigned,unassigned}` · `v1:access:changed`
- **Spatial (Spec 1):** `v1:buildingModel:{versionUploaded,activated,deleted}`
- **Devices (F2/Spec4):** `v1:device:{created,updated}` (Spec 4 nodes ride `:updated` for `x/y/z`)
- **Monitoring (Spec 7):** `v1:device:status`
- **BCF (Spec 6):** `v1:bcf:topic:{created,updated}` · `v1:bcf:comment:added`

---

## 4. Reference notes (consistency pass)

- **No error-code name collisions** across the 13 specs (one code → one name); **no endpoint path collisions**.
- **Normalized while building this reference:** the Spec 6 BCF plans had two ad-hoc codes — fixed to convention: building-not-found → reuse **`PROP_001`**; topic-not-found → **`BCF_004`**; patch version mismatch → **`BCF_005`** (was the non-conforming `BCF_404`/`ORG_CONFLICT`).
- **Optimistic-version conflicts** currently surface per-feature (`BCF_005`, and various `ORG_004/005` 409s in F1a). Recommendation for the build: introduce **one shared `*_409 VERSION_CONFLICT`** for `ChangesetDto.baseVersion` mismatches rather than a code per feature.
- **Ingest auth** is the one non-session path: `POST /monitoring/ingest` accepts an **org ingest token** (Spec 7) *or* a **per-agent token** (Spec 8, `x-agent-token` → `source=agent:<id>`).
- **Pre-existing baseline codes** (the 2D app: e.g. `DEVICE_001`, `SYNC_001`) live in the original API Design Document and are outside this corpus.
- The WS list above is the event set; family prefixes (`v1:device`, `v1:bcf`, …) are namespaces, not events.
