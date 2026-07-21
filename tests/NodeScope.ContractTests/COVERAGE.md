# Contract suite coverage

Tracks the black-box contract suite (migration Decision 4 / Sequencing step 2)
against the NestJS API: **121 HTTP endpoints + the Better Auth surface + 49
websocket events**, green against Node before the C# port begins, then re-run
against the C# host as modules land.

Status legend: `[x]` covered · `[~]` partial · `[ ]` not started.

Grouped by the **target C# module** (Decision 2), not by the current Nest
controller, so the tracker doubles as the port work-list.

---

## Identity  (auth, users, orgs, permissions)

**Better Auth**  (`/api/auth/*` - mounted via catch-all, not in the 121)
- [x] POST `/api/auth/sign-up/email`, `/sign-in/email`, `/sign-out`
- [x] GET `/api/auth/get-session`
- [x] POST `/api/auth/request-password-reset`
- [ ] reset-password, update-user, change-password (if exercised by clients)

**users.controller** (6)
- [x] GET `/api/v1/users/me`
- [x] PATCH `/api/v1/users/me`
- [x] GET `/api/v1/users/me/preferences` · [x] PUT `/api/v1/users/me/preferences`
- [ ] POST `/api/v1/users/location`
- [ ] GET `/api/v1/users/me/data-sources`  (needs org context)

**organizations.controller** (3)
- [x] GET `/api/v1/organizations/me` · [x] GET `/api/v1/organizations/me/members`
- [x] PATCH `/api/v1/organizations/me`  (OWNER rename + version bump + `SYNC_001` stale conflict)

**admin-organizations.controller** (3) - super-admin
- [x] POST `/api/v1/admin/organizations` · [x] POST `:id/domains` (`ORG_004` dup) · [x] POST `:id/owner` (`ORG_003`/`ORG_001`)
- [x] guard chain: unauth `AUTH_002`, authed non-super-admin `ORG_007`

**invitations / join-requests / members** (2+3+1+3+2)
- [~] invitations.controller: POST/GET/DELETE `/api/v1/organizations/me/invitations`
      (POST + DELETE happy paths exercised by `Realtime/` and `OrgProvisioning.AddMemberAsync`;
      GET list + the error envelopes `ORG_009`/`PERM_003` still open)
- [~] invitation-accept.controller: POST `/api/v1/invitations/accept`
      (happy path exercised; `ORG_009`/`ORG_010`/`ORG_011` envelopes still open)
- [~] join-request-submit.controller: POST `/api/v1/join-requests`
      (domain-matched happy path exercised by `Realtime/`; `ORG_011`/`ORG_014`/`ORG_015` still open)
- [~] join-requests.controller: GET + approve/deny under `/api/v1/organizations/me/join-requests`
      (pending list + approve + deny exercised by `Realtime/`; status filter + `ORG_012` still open)
- [ ] members.controller: PATCH/DELETE `/api/v1/organizations/me/members/:userId`

**permissions / teams / member-assignments** (1+8+3)
- [ ] permissions.controller: GET `/api/v1/access/me`
- [~] teams.controller: 8 endpoints under `/api/v1/teams`
      (create/rename/delete/member add + remove/property assign + unassign happy paths
      exercised by `Realtime/`; GET list + `TEAM_002`/`SYNC_001`/role-gate envelopes still open)
- [~] member-assignments.controller: GET `/api/v1/members/:memberId/access`, POST/DELETE properties
      (POST grant + DELETE revoke exercised by `Realtime/`; GET access + `PERM_002`/`PERM_003` still open)

**desktop-auth.controller** (3)
- [ ] GET `/api/v1/desktop-auth/authorize` · POST `/token` · POST `/revoke`

## Inventory  (devices, networks, circuits, fiber, properties, map, spatial, bcf, models)

- [x] devices.controller (6): GET/POST `/api/v1/devices`, name-suggestion, GET/PATCH/DELETE `:id`
      (placement `PROP_007`, name-clash `ORG_005`, `?buildingPropertyId` bare array, `DEVICE_001`, `SYNC_001`)
- [ ] spatial.controller (2): PATCH `/api/v1/devices/:id/position`, `/ifc-link`
- [x] networks.controller (6): CRUD + `:id/set-home-ip`
      (one-per-org `NETWORK_001`, summary hides `homePublicIp` / detail reveals it, `NETWORK_002`, `SYNC_001`)
- [~] network-property.controller (3): `/api/v1/networks/:networkId/properties`
      (POST add envelope `{id, networkId, propertyId}` + DELETE remove exercised by `Realtime/`;
      GET list + the coverage/containment error paths still open)
- [x] circuits.controller (5): CRUD under `/api/v1/circuits`
      (cursor page `items/nextCursor/total`, device link + unknown-device `DEVICE_001`, `CIRCUIT_001`, `SYNC_001`)
- [ ] fiber-runs.controller (5): CRUD under `/api/v1/fiber-runs`
- [~] connections.controller (4): CRUD under `/api/v1/device-connections`
      (updated + deleted realtime events covered under `Realtime/`; HTTP CRUD envelopes still open)
- [x] properties.controller (5): CRUD under `/api/v1/properties`
      (nesting `PROP_002`, sibling-name `PROP_003`, not-empty delete `PROP_004`, `PROP_001`, `SYNC_001`)
- [ ] map.controller (3): `/api/v1/map/{devices,fiber-runs,circuits}`
- [~] bcf.controller (7): import/export/topics/comments under `/api/v1/buildings/:propertyId/bcf` + `/api/v1/bcf/topics/:id`
      (topic create/patch/comment happy paths exercised by `Realtime/`; import/export,
      topic list/detail, and the `BCF_005`/`PROP_001` envelopes still open)
- [~] building-models.controller (7): model versions/active/file (needs storage)
      (raw-body upload + PUT active + DELETE version happy paths exercised by `Realtime/`
      against the test MinIO; the reads, file downloads, and `MODEL_00x` envelopes still open)
- [ ] export.controller (1): GET `/api/v1/buildings/:propertyId/export/ifc`
- [ ] clients.controller (1): GET `/api/v1/clients`
- [~] onboarding.controller (2): POST `/api/v1/onboarding/{turn,skip}`
      (turn happy path exercised by `Realtime/`; skip, the chip/field flows, and `ONBOARD_002` still open)

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
- [ ] snmp.controller (9): credentials + oid-profiles CRUD + assign
- [ ] bandwidth.controller (2): GET/POST `/api/bandwidth/echo`

## Assistant  (ai)

- [ ] ai.controller (2): GET `/api/v1/ai/usage`, DELETE `/api/v1/ai/conversation/:conversationId`

## Platform / host

- [x] health.controller (1): GET `/api/health`  (probed by the fixture on start)

## Realtime  (49 websocket events, under `Realtime/`)

Protocol changes socket.io -> SignalR, so parity is asserted on **semantics**
(which event fires, with which payload, to which subscribers) behind one client
adapter, not at the wire level (Decision 4).
- [x] Adapter interface + socket.io implementation (`Fixtures/RealtimeClient.cs`:
      `IRealtimeClient` + `SocketIoRealtimeClient` over SocketIOClient; cookie-authed
      connect, buffered consume-once `WaitForEventAsync`, ping/pong, unauth rejection,
      **cross-org scope isolation**, and the onHome readiness barrier - `Realtime/RealtimeScaffold.cs`)
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

**Done so far:** 152 tests green.

- **Identity (24):** org-free and seeded-owner read/mutation paths, both auth
  credential forms, the success and error (`AUTH_002`, `ORG_002`) envelopes, plus
  the **super-admin bootstrap + per-test org provisioning** harness
  (`Fixtures/{SuperAdminGrant,OrgProvisioning}.cs`,
  `ContractApiFixture.ProvisionOrgAsync`) and the admin-organizations surface it
  unlocks.
- **Inventory (44):** properties, networks, circuits, and devices under
  `tests/NodeScope.ContractTests/Inventory/`. Each test grabs an isolated org via
  `fixture.ProvisionOrgAsync()` (fresh org + fresh OWNER, `org.OwnerCookie` /
  `org.OwnerBearer`). Device placement needs a chartered site, so
  `Inventory/InventoryScaffold.cs` assembles a SITE + the org's network + a charter
  (a real operator flow over HTTP) - the arrange step for every device test and the
  device-linked circuit. Covers the CRUD envelopes, the changeset `SYNC_001`
  conflict shared across all four, and the module-specific invariants: the
  property-nesting rules, the one-network-per-org limit, the summary/detail
  `homePublicIp` split, cursor vs offset pagination, and the device placement rule.
- **Monitoring machine-auth + reads (37):** the agents/agent-ingest/ingest surface under
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
- **Realtime adapter (47):** the transport-agnostic `IRealtimeClient` and its socket.io
  implementation (`Fixtures/RealtimeClient.cs`, over the SocketIOClient NuGet), proven end
  to end against the Node gateway: a cookie-authenticated connect, all three fan-out modes
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

That provisioning harness remains the prerequisite for the rest of the
Inventory/Monitoring endpoints, which each need an isolated org.
