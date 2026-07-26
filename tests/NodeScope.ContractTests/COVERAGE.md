# Contract suite coverage

Tracks the permanent black-box contract suite for the ASP.NET Core appliance.
The suite began as a migration parity catalogue for 121 HTTP endpoints, the
retired auth surface, and 49 realtime events. It now verifies the native auth,
HTTP, and SignalR contracts directly against the current host.

Status legend: `[x]` covered · `[~]` partial · `[ ]` not started.

Grouped by the owning C# module.

---

## Identity  (auth, users, orgs, permissions)

**Auth** (`/api/v1/auth/*` - the native surface that replaced the Better Auth wire
shim on 2026-07-26; envelope + raw Bearer token, no cookies)
- [x] POST `/api/v1/auth/sign-up` (201 `{token}`; taken email `AUTH_005`; short
      password `GEN_001`)
- [x] POST `/api/v1/auth/sign-in` (200 `{token}`, fresh session; wrong password and
      unknown email both `AUTH_001`)
- [x] POST `/api/v1/auth/sign-out` (204; token dead immediately; repeat is 401 `AUTH_002`)
- get-session and request-password-reset died with the shim: the desktop reads
  `/api/v1/users/me` instead, and no email sender exists to make reset real

**First-organization bootstrap**
- [x] POST `/api/v1/bootstrap/organization` (authenticated, but intentionally
      outside the organization guard; invalid token `ORG_017`, already-claimed
      appliance `ORG_018`; the success path is proven by the desktop
      empty-database E2E)

**users.controller** (6)
- [x] GET `/api/v1/users/me`
- [x] PATCH `/api/v1/users/me`
- [x] GET `/api/v1/users/me/preferences` · [x] PUT `/api/v1/users/me/preferences`
- [x] POST `/api/v1/users/location`  (`UsersExtrasContractTests`: lat/lng echo + persist
      to `users/me`; empty body and out-of-range latitude `GEN_001`; the address branch
      geocodes through Nominatim - external network - so only its validation is pinned)
- [x] GET `/api/v1/users/me/data-sources`  (browser source disconnected/null for a fresh
      owner; org-less user `ORG_002`)

**organizations.controller** (3)
- [x] GET `/api/v1/organizations/me` · [x] GET `/api/v1/organizations/me/members`
- [x] PATCH `/api/v1/organizations/me`  (OWNER rename + version bump + `SYNC_001` stale conflict)

**admin-organizations.controller** (3) - super-admin
- [x] POST `/api/v1/admin/organizations` · [x] POST `:id/domains` (`ORG_004` dup) · [x] POST `:id/owner` (`ORG_003`/`ORG_001`)
- [x] guard chain: unauth `AUTH_002`, authed non-super-admin `ORG_007`

**invitations / join-requests / members** (2+3+1+3+2)
- [x] invitations.controller: POST/GET/DELETE `/api/v1/organizations/me/invitations`
      (`InvitationsContractTests`: pending list drops accepted invitations; revoke unknown
      `ORG_009`; ADMIN invites MEMBERs only - anything higher `PERM_003` - and a MEMBER
      nothing at all `ORG_003`)
- [x] invitation-accept.controller: POST `/api/v1/invitations/accept`
      (bad/spent token `ORG_009`, mismatched email `ORG_010`/403, already-membered user
      `ORG_011`/409)
- [x] join-request-submit.controller: POST `/api/v1/join-requests`
      (`JoinRequestsContractTests`: unclaimed domain `ORG_014`, already-member `ORG_011`,
      duplicate pending `ORG_015`)
- [x] join-requests.controller: GET + approve/deny under `/api/v1/organizations/me/join-requests`
      (list defaults to PENDING and honors `?status=`; deciding an unknown OR already-decided
      request is the same `ORG_012`)
- [x] members.controller: PATCH/DELETE `/api/v1/organizations/me/members/:userId`
      (`MembersContractTests`: OWNER promotes and the members list reflects it; unknown target
      `ORG_002`/404; the last OWNER can neither self-demote nor be removed `ORG_013`/409;
      ADMIN removes MEMBERs but any privileged target or destination role is `ORG_003`;
      removal observably evicts - the ex-member's org calls flip to `ORG_002`)

**permissions / teams / member-assignments** (1+8+3)
- [x] permissions.controller: GET `/api/v1/access/me`
      (`AccessContractTests`: OWNER unscoped+empty roots; MEMBER exact granted roots,
      empty before the grant; org-less `ORG_002`)
- [x] teams.controller: 8 endpoints under `/api/v1/teams`
      (`TeamsContractTests`: TeamDto shape; `TEAM_002` on create AND rename collision; flat
      versioned rename with `SYNC_001`; `TEAM_001` unknown; scope-filtered list - a site-less
      team reaches only the OWNER; member-add and site-assign are IDEMPOTENT, returning the
      same association id; unknown member `ORG_001`; MEMBER `ORG_003`)
- [x] member-assignments.controller: GET `/api/v1/members/:memberId/access`, POST/DELETE properties
      (`MemberAccessContractTests`: access-as-seen-by with grant/revoke flip; unknown member
      `ORG_001`; ADMIN delegating beyond own scope `PERM_002`; ADMIN touching a privileged
      target `PERM_003`)

**desktop-auth.controller** (0 - DEMOLISHED 2026-07-26)
- The `/api/v1/desktop-auth/*` PKCE flow and the host-served `/login` page are gone:
  the desktop signs in natively over the `/api/v1/auth` surface above. The appliance
  has no browser surface anymore.

## Inventory  (devices, networks, circuits, fiber, properties, map, spatial, bcf, models)

- [x] devices.controller (6): GET/POST `/api/v1/devices`, name-suggestion, GET/PATCH/DELETE `:id`
      (placement `PROP_007`, name-clash `ORG_005`, `?buildingPropertyId` bare array, `DEVICE_001`, `SYNC_001`)
- [x] spatial.controller (2): PATCH `/api/v1/devices/:id/position`, `/ifc-link`
      (`SpatialContractTests`: setting either requires an actively-modeled building
      `SPATIAL_001`/422 while explicit-null CLEARING never does - and absent fields are
      left untouched, nulls must be explicit; a partial x/y/z triple is `SPATIAL_002`/422;
      unknown device `DEVICE_001`)
- [x] networks.controller (6): CRUD + `:id/set-home-ip`
      (one-per-org `NETWORK_001`, summary hides `homePublicIp` / detail reveals it, `NETWORK_002`, `SYNC_001`)
- [x] network-property.controller (3): `/api/v1/networks/:networkId/properties`
      (`NetworkPropertyContractTests`: list rows `{id, networkId, propertyId}`; duplicate
      charter `PROP_006`/409; unknown property (add) and non-chartered site (remove) are
      `PROP_001`; removing a charter still governing devices is `PROP_008`/409 - the guard
      that makes device placement permanent)
- [x] circuits.controller (5): CRUD under `/api/v1/circuits`
      (cursor page `items/nextCursor/total`, device link + unknown-device `DEVICE_001`, `CIRCUIT_001`, `SYNC_001`)
- [x] fiber-runs.controller (5): CRUD under `/api/v1/fiber-runs`
      (`FiberRunsContractTests`: create between two distinct devices - same device
      `FIBER_002`/422, missing endpoint `DEVICE_001`; flat items/total list with a
      UUID-validated `?deviceId` filter (`GEN_001` otherwise); unknown AND foreign runs
      the same `FIBER_001`; changeset patch + `SYNC_001`; delete returns null data)
- [x] connections.controller (4): CRUD under `/api/v1/device-connections`
      (`ConnectionsContractTests`: uniqueness is the (source, target, type) TRIPLE -
      same triple `CONN_003`/409, different type is a distinct link; self-connection
      `CONN_002`/422; items/total list + `?deviceId` filter; changeset patch + `SYNC_001`;
      unknown/foreign `CONN_001`)
- [x] properties.controller (5): CRUD under `/api/v1/properties`
      (nesting `PROP_002`, sibling-name `PROP_003`, not-empty delete `PROP_004`, `PROP_001`, `SYNC_001`)
- [x] map.controller (3): `/api/v1/map/{devices,fiber-runs,circuits}`
      (`MapContractTests`: malformed AND out-of-range bboxes `GEN_001`; geometry rides on
      device lat/lng (the DB trigger fills the PostGIS point) - a device answers iff inside
      the envelope with `?floor` honored, a fiber run iff EITHER endpoint is, a circuit iff
      its linked device is)
- [x] bcf.controller (7): import/export/topics/comments under `/api/v1/buildings/:propertyId/bcf` + `/api/v1/bcf/topics/:id`
      (`BcfContractTests`: list + detail (comments included); unknown topic `BCF_004`,
      stale patch `BCF_005`/409, unknown building `PROP_001`; export streams a real ZIP
      (PK magic, octet-stream, .bcfzip disposition); import is multipart - garbage is
      `BCF_003`/422, and the export re-imports into ANOTHER org's building round-trip
      (same-org re-import would only upsert the source topic, keyed [org, guid]))
- [x] building-models.controller (7): model versions/active/file
      (`BuildingModelsContractTests` against the test MinIO: modelless building `MODEL_001`
      on every read; upload refuses non-BUILDINGs `MODEL_002` and non-IFC bytes `MODEL_007`;
      upload auto-activates and both file downloads round-trip the exact bytes with
      attachment headers; unknown versions `MODEL_004`; deleting the ACTIVE version is
      `MODEL_005`/409 until a newer upload frees it)
- [x] export.controller (1): GET `/api/v1/buildings/:propertyId/export/ifc`
      (`ExportContractTests`: a placed device exports as a raw ISO-10303-21 STEP file,
      application/x-step, `-network.ifc` disposition; SITEs and unknown ids are the same
      invisible `PROP_001` - only BUILDINGs export)
- [x] clients.controller (1): GET `/api/v1/clients`
      (`ClientsContractTests`: User-Agent echoed and platform parsed from it; metrics null
      for a fresh user; agentStatus fixed unavailable; org-less `ORG_002`)
- [x] onboarding.controller (2): POST `/api/v1/onboarding/{turn,skip}`
      (`OnboardingContractTests`: the full wizard walk - welcome→networkName→address→
      browserDeviceName→mobility→confirmHomeIp→routerMac→modemMac→isp→speeds→done - with
      chips/fields/progress asserted per step and the address-step save observably creating
      the org's network; an input of the wrong kind stays on the step; after completion a
      fresh turn is `ONBOARD_002`/409; skip clears in-flight state so a later turn restarts;
      MEMBER `ORG_003`)

## Monitoring  (agents, snmp, ingest, bandwidth)

**Machine-auth paths landed 2026-07-20** (`Monitoring/`) - the two custom-header
credential families (Decision 7) carried by `Auth.WithHeader`.
- [x] agents.controller (4): enrollment-code, list, revoke, delete under `/api/v1/agents`
      (OWNER/ADMIN session; revoke invalidates the `x-agent-token`, cross-org `AGENT_002`,
      role gate `ORG_003`, no-org `ORG_002`, unauth `AUTH_002`)
- [x] agent-ingest.controller (3): `/api/v1/monitoring/agent/{enroll,devices,heartbeat}`  (x-agent-token)
      (enroll redeems a single-use code -> token; reuse/unknown code `AGENT_001`; devices lists
      only IP-bearing devices; heartbeat 204; bad/absent token `AUTH_002`)
- [x] ingest.controller (2): POST `/api/v1/monitoring/ingest`, `/ingest-token`  (x-ingest-token)
      (accepts x-agent-token OR org token as x-ingest-token/Bearer; 202 `{ accepted }`;
      OWNER-only mint `ORG_003`; foreign device `ORG_008`; over-cap 413 `GEN_005` vs malformed
      400 `GEN_001`; round-trip proven through device-status = UP)
- [x] monitoring.controller (4): device-status, metrics, metric-names, status-events
      (`Monitoring/MonitoringReadContractTests.cs`: UNKNOWN + null fields for a never-probed
      device, bucketed averages for reachable + latency_ms, metric-names, status-events
      newest-first honoring `?limit`, the window guards MON_001 (inverted) / MON_002 (bucket
      cap) vs GEN_001 (non-allow-listed bucket, validation - fires before the window rules),
      and invisible-not-forbidden DEVICE_001 for unknown/foreign/out-of-scope alike with the
      F3 flip: a MEMBER 404s until granted the governing site, then reads the series)
- [x] snmp.controller (9): credentials + oid-profiles CRUD + assign
      (`Monitoring/{SnmpContractTests,SnmpAssignContractTests}.cs`: secrets in, presence
      flags out - no response ever carries a plaintext secret or the `*Enc` names; unknown
      AND foreign ids are the same `SNMP_001`/`SNMP_002` 404; `SNMP_003`/409 refuses deleting
      an assigned credential/profile until an explicit-null assign clears it; assign requires
      both fields present (null = unassign, absence = `GEN_001`), validates cred/profile
      before target (`NETWORK_002`/`DEVICE_001`), and is F3-scoped per target - device
      `PERM_001`, network full-charter-coverage `PERM_004`, both proven with the grant flip
      on an HTTP-built ADMIN; MEMBER is `ORG_003` even on reads; resolution proven through
      the agent devices list: decrypted community round-trip, per-field override-wins (a
      device credential beats the network's while the profile still falls back), and
      explicit-null clearing restores the network default)
- [x] bandwidth.controller (2): GET/POST `/api/bandwidth/echo`
      (`BandwidthContractTests`: public + unthrottled raw-wire surface, no JSON envelope;
      GET serves exactly 1,000,000 octet-stream bytes with matching Content-Length and
      Cache-Control no-store, and the payload is measurably random (incompressible on the
      wire); POST drains a 1 MB body - and an empty one - to 204)

## Assistant  (ai)

- [x] ai.controller (2): GET `/api/v1/ai/usage`, DELETE `/api/v1/ai/conversation/:conversationId`
      (`Assistant/AiContractTests`: usage returns zeroed counters with positive limits and a
      resetsAt for a fresh user; unauth `AUTH_002`. Delete: unknown conversation `GEN_002`/404 -
      the only reachable envelope, since the degraded provider never persists a conversation
      (the fallback path skips the append), so the happy-path delete cannot be provoked
      black-box)

## Platform / host

- [x] health.controller (1): GET `/api/health`  (probed by the fixture on start)

## Realtime  (49 websocket events, under `Realtime/`)

The suite asserts **semantics**: which event fires, with which payload, to which
subscribers.
- [x] SignalR adapter (`Fixtures/{RealtimeClient,SignalRRealtimeClient}.cs`):
      Bearer-authenticated connect, buffered consume-once `WaitForEventAsync`,
      ping/pong, unauthenticated rejection, **cross-org scope isolation**, and the
      onHome readiness barrier in `Realtime/RealtimeScaffold.cs`
- [x] Device / circuit / fiber-run / connection / network mutation events
      (device, circuit, fiber-run, and connection updated + deleted, network updated on
      create, charter added + removed - added carries the charter id, removed only the pair;
      device:status proven edge-triggered through the whole anti-flap ladder: first-check
      UP emits, one failure emits WARNING, a second same-state failure is silent, and the
      third crosses MONITORING_DOWN_THRESHOLD to emit DOWN)
- [x] Property / building-model / bcf events
      (property created + updated + deleted, and the moved-vs-updated split: a reparent
      emits property:moved INSTEAD of updated, asserted with a negative window; bcf topic
      created + updated carrying the full topic DTO and comment added carrying the new
      comment; the building-model version lifecycle - uploaded, activated only on the
      explicit PUT (the upload's auto-activation is event-silent), deleted - via
      `ApiClient.PostRawAsync`, since the upload streams raw bytes, not multipart)
- [x] Org / member / invitation / join-request / team / assignment events
      (member added + updated + removed to the org room, including the second member:added
      emit path via join-request approval; invitation created + revoked + accepted, with the
      created event carrying the normalized email; joinRequest created + decided for both
      verdicts, denial asserted member-less; org rename asserted realtime-silent -
      `v1:org:updated` is in the catalogue but unemitted; the full team lifecycle
      (created owner-only via the empty scope list, updated, deleted, member added +
      removed, property assigned + unassigned) and the direct member-site grant +
      revoke; the team/assignment family is pinned timestamp-less - it bypasses the
      conflict-service wrapper that stamps entity events)
- [~] AI streaming (token/complete), onboarding turn, metrics, ping/pong, access-changed
      (ping/pong + the onHome per-connection event covered; access-changed proven to target
      the affected USER's room - the granted member's socket hears it, with `{organizationId}` -
      on both the direct-grant and team-membership paths; the metrics submit -> scheduled
      per-user push round-trip covered end to end - the target runs REFRESH_INTERVAL_SECONDS=2
      so a push cycle is observable; onboarding:turn covered mirroring the HTTP response's
      stepId/complete; AI streaming covered in the degraded mode the target runs in - the
      canned fallback arrives as one ai:token followed by ai:complete with matching content,
      providerStatus 'unavailable', and zero tokens charged. Still open: `v1:error` - its
      only emit path is an AI rate-limit/internal failure, and with the degraded provider
      usage never increments, so no deterministic trigger exists over the black-box surface)

---

**Current result:** 259 tests green - every HTTP endpoint and reachable SignalR event in the
tracker is covered (or explicitly excluded with its reason inline above). The suite
is the permanent black-box integration gate for the appliance.

Running the full suite trips the interactive-client rate limits (hundreds of
sign-ups from one IP), so the non-production throttle limits are env-overridable
(`THROTTLE_DEFAULT_LIMIT`/`THROTTLE_AUTH_LIMIT` - the route-level strict auth and
enroll throttles honor the same variable), and `scripts/run-csharp-host.sh` lifts
them for the local non-production target. Production limits stay hardcoded.

- **Identity:** org-free and seeded-owner read/mutation paths, native auth
  credential forms, the success and error (`AUTH_002`, `ORG_002`) envelopes, plus
  the **super-admin bootstrap + per-test org provisioning** harness
  (`Fixtures/{SuperAdminGrant,OrgProvisioning}.cs`,
  `ContractApiFixture.ProvisionOrgAsync`) and the admin-organizations surface it
  unlocks. The close-out sweep added the users extras (location, data-sources), the
  full member-management matrix with the ORG_013 last-owner invariant, the
  invitation/join-request error envelopes, the access summary, the team surface
  (idempotent associations, scope-filtered list, TEAM_002/SYNC_001), the
  member-assignment guards (PERM_002/PERM_003), native sign-up and sign-in, and
  first-organization bootstrap closure.
- **Inventory:** properties, networks, circuits, and devices under
  `tests/NodeScope.ContractTests/Inventory/`. Each test grabs an isolated org via
  `fixture.ProvisionOrgAsync()` (fresh org + fresh OWNER, `org.OwnerAuth`).
  Device placement needs a chartered site, so
  `Inventory/InventoryScaffold.cs` assembles a SITE + the org's network + a charter
  (a real operator flow over HTTP) - the arrange step for every device test and the
  device-linked circuit. Covers the CRUD envelopes, the changeset `SYNC_001`
  conflict shared across all four, and the module-specific invariants: the
  property-nesting rules, the one-network-per-org limit, the summary/detail
  `homePublicIp` split, cursor vs offset pagination, and the device placement rule.
  The close-out sweep added spatial placement (SPATIAL_001/002 with explicit-null
  clears), fiber-run and connection CRUD (the (source,target,type) uniqueness
  triple), the charter list/guards (PROP_006/PROP_008), the PostGIS-backed map bbox
  reads, the clients read, the BCF read/patch/import/export surface with the
  cross-org bcfzip round-trip, the building-model reads and byte-exact file
  downloads, the IFC network export, and the full onboarding wizard walk with its
  ONBOARD_002 completion gate.
- **Monitoring machine-auth + reads + SNMP + bandwidth (60):** the agents/agent-ingest/ingest surface under
  `tests/NodeScope.ContractTests/Monitoring/`, covering both custom-header credential
  families (`x-agent-token` / `x-ingest-token`) end to end. `Monitoring/MonitoringScaffold.cs`
  mints the credentials the way an operator and collector would - an owner issues an
  enrollment code, the session-less enroll route redeems it for an agent token, and the
  owner mints the per-org ingest token - and stands up a probeable device (a chartered
  SITE -> BUILDING with an IP'd device) so the agent devices list, ingest, and the
  device-status read all have something real. The revoke test proves a management action
  actually invalidates a live machine token; the ingest test proves a machine credential's
  write is observable through device-status. Role gating reuses a new
  `OrgProvisioning.AddMemberAsync` (invite + accept over HTTP) to get a genuine non-owner
  member, the case `ORG_003` exists to reject. The read side
  (`Monitoring/MonitoringReadContractTests.cs`) closes monitoring.controller: the UNKNOWN
  snapshot, the bucketed series and names the ingest wrote, status-events newest-first with
  `?limit`, the MON_001/MON_002 window guards vs the GEN_001 validation layer, and the
  invisible-not-forbidden DEVICE_001 contract proven across unknown, foreign-org, and
  out-of-F3-scope devices - including the grant flip that makes a member's 404 turn 200.
  The SNMP surface (`Monitoring/{SnmpContractTests,SnmpAssignContractTests}.cs`) closes the
  module: credential/profile CRUD with the secrets-in-flags-out contract, the SNMP_003
  assigned-delete refusal, the assign envelope with its explicit-null unassign semantics and
  per-target F3 rules (device PERM_001, network full-charter PERM_004, flipped by direct
  member-site grants on an ADMIN built entirely over HTTP - invite at role ADMIN, accept,
  grant), and the resolution contract proven through the agent devices list: the community
  decrypts back to the created plaintext, a device-level credential overrides the network's
  per field while the profile falls back, and clearing the device pair restores the network
  default. Bandwidth closes the module: the public unthrottled echo pair, byte-exact.
- **Assistant (3):** the AI HTTP surface in the degraded mode the target runs in - the
  usage counters with their limits, the auth gate, and the GEN_002 conversation-delete
  envelope (the only reachable one while the provider never persists conversations).
- **Realtime adapter (47):** the `IRealtimeClient` SignalR implementation, proven end
  to end against the ASP.NET Core host with Bearer authentication and all three fan-out modes
  (the scoped device/circuit/fiber-run/connection updated + deleted events, the owner-room
  network event, and the org-room member added/updated/removed events), a property-created
  event, the org rename asserted realtime-silent, the ping/pong round-trip, an unauthenticated
  socket being disconnected, and - the load-bearing one - a device mutation in org A never reaching org B's
  socket while B still receives its own. On top of that, the org-accession lifecycle
  (`Realtime/OrgInvitationRealtimeTests.cs`, `Realtime/OrgJoinRequestRealtimeTests.cs`): invitation
  created (normalized email) / revoked / accepted, joinRequest created (id cross-checked against the
  owner's pending list, since the submit response is bodiless) / decided for both verdicts, approval
  emitting member:added over its second emit path and denial asserted member-less in a negative
  window. And the property tree (`Realtime/PropertyRealtimeTests.cs`): property updated on
  rename, deleted, the moved-vs-updated split on reparent (moved fires, updated must not),
  and the network charter added (with charter id) / removed (pair only) events. And the
  permissions family (`Realtime/{TeamRealtimeTests,MemberAccessRealtimeTests}.cs`): the
  team lifecycle (created reaching the owner room through an empty scope list, renamed via
  its flat versioned body, deleted, member added + removed speaking org-member ids, site
  assigned + unassigned), the direct member-site grant + revoke, and access:changed proven
  to target the affected USER's room on both the grant and team-membership paths - with the
  whole family pinned timestamp-less, since it bypasses the conflict-service wrapper that
  stamps entity events. And the telemetry loop
  (`Realtime/{MonitoringRealtimeTests,OnboardingRealtimeTests}.cs`): device:status
  edge-triggered through the full anti-flap ladder (UP, WARNING on one failure, silence on
  the second, DOWN crossing the threshold), the metrics submit -> scheduled per-user push
  round-trip with the submitted sample echoed back tagged `browser`, and onboarding:turn
  mirroring the HTTP response's stepId/complete pair to the org room. And the last two
  families (`Realtime/{BcfRealtimeTests,AiRealtimeTests,BuildingModelRealtimeTests}.cs`):
  bcf topic created + updated (full topic DTO) and comment added (the new comment itself);
  the AI streaming shape in the degraded mode the target deliberately runs in - the canned
  fallback arriving as one ai:token followed by an ai:complete with matching content,
  providerStatus 'unavailable', and zero tokens charged; and the building-model version
  lifecycle (uploaded via the raw-byte `ApiClient.PostRawAsync` against the test MinIO,
  activated only by the explicit PUT while the upload's auto-activation stays event-silent,
  deleted). With that, every deterministically-reachable event in the 49-event catalogue is
  asserted; the lone remainder is `v1:error`, whose only trigger (an AI rate-limit or
  internal failure) cannot be provoked over the black-box surface while the provider is
  degraded. The connect/emit race is closed deterministically by a readiness barrier
  (`Realtime/RealtimeScaffold.cs`): the gateway emits `v1:network:onHome:changed` only after
  a socket has joined its rooms, so waiting for it guarantees a later mutation can be seen.
  The interface is the invariant; the SignalR implementation drops in behind it at the port.

With the migration closed, the suite remains the release gate for every API and
realtime change.
