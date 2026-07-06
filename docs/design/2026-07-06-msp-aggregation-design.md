# MSP cross-site aggregation (local-first #4)

**Date:** 2026-07-06
**Status:** design — pending user review, then plan + phased build
**Type:** implementation spec — local-first required-change #4 (the "central pane of glass")
**Parent:** `docs/design/2026-06-30-local-first-architecture-direction.md` (#4: "MSP central aggregation layer — the main new build")
**Relates to:** alerting #6 (`feat/alerting`) — this is the **cloud relay** #6 deferred here; the appliance uplink reads alert/health data added by #6.

## Context

NodeScope is pivoting local-first: each site runs a self-contained on-prem **appliance** (docker-compose stack, source of truth, no host-published DB). An MSP / internal IT team needs one **central pane of glass** over many client sites — but under NodeScope's hard sovereignty rule, the same ethos as its zero-network-data IFC export: **aggregates + alerts flow up to the cloud; raw logs (IP/MAC/ports/device names/network names/topology/metric series) never leave the LAN.** The cloud holds rollups and *drills back into the site's own appliance* on demand ("the cloud points at the appliance," never copies its logs).

Current constraints from the codebase: the schema is single-tenant with a hard **one-user-one-org** rule (`OrganizationMember.userId @unique`) and no parent-org concept — so the aggregator needs **its own tenancy model**, not a reuse of `Organization`. The only outbound precedents are the alerting **heartbeat** (`alert-heartbeat.service.ts` — a best-effort POST of `{at, devicesDown}`) and the **encrypted off-site backup** (public-key, provider sees only ciphertext). Enrollment has a precedent too: the agent **enrollment-code → per-agent bearer token** flow (`AgentEnrollmentCode`/`Agent`).

## Decisions (from brainstorming)

- **Topology = BOTH.** Appliances **push** periodic health/alert summaries to an always-on central **aggregator** (rollup tiles, stale-tolerant), AND the NOC can **drill into** a specific site's live appliance UI on demand (federated).
- **Payload = health rollup + alert events.** Per-site counts + SLA + inventory + last-seen, PLUS alert `FIRING`/`RESOLVED` events (severity + an **opaque** device pointer, never a name/IP). No raw logs, no topology.
- **Cloud alert role = full relay.** The aggregator detects "site went dark" (missing pushes = the real out-of-band signal #6 deferred here) AND fans site-down + forwarded alerts out to **NOC-level channels** (the MSP's own webhook/email/etc.). The appliance still owns its own local channel delivery.
- **Scope = full system in one spec** (built in phases A→B→C below).

### Recommended defaults for the pieces not explicitly chosen

- **Aggregator tenancy:** a new, independent model in the aggregator's own DB — `MspTenant` (the MSP org) → `Customer` (a client company) → `Site` (one appliance/one client org). `NocUser` belongs to an `MspTenant` with `NocRole` (`OWNER|OPERATOR|VIEWER`). This is fully separate from the appliance's `Organization` model (which stays one-user-one-org).
- **Enrollment + transport:** the aggregator issues a one-time **site enrollment code** (scoped to a `Customer`); the appliance operator runs `nodescope.sh msp-enroll <code>` → the appliance exchanges it for a **per-site credential** (a site id + bearer secret, stored encrypted via `SECRET_ENCRYPTION_KEY`). Each push is an **HTTPS POST** of the rollup to the aggregator ingest endpoint, authenticated by the per-site bearer and **HMAC-signed** (body signature) to prove integrity. Cadence configurable (default 60s); best-effort with a bounded on-appliance retry queue (reuse the delivery-queue ethos). TLS in transit; the aggregator is the only party that sees the (already sovereignty-safe) rollup.
- **Federated drill-in:** each `Site` stores its appliance's reachable URL (its cloudflared tunnel hostname, provided at enrollment). A NOC "drill in" is an **opaque redirect** to that URL — the NOC operator authenticates to the *appliance* directly; no raw data is copied into the cloud.

## Architecture

```
   ┌─────────────── SITE APPLIANCE (source of truth) ───────────────┐
   │ NodeScope api/web/db (compose)                                   │
   │  MspUplinkService (Phase A):                                     │
   │   • builds a SiteRollup + AlertUplink[] from DeviceStatus /      │
   │     AlertEvent / inventory  (sovereignty serializer + denylist)  │
   │   • Redis-NX loop → HTTPS POST (bearer + HMAC) to aggregator     │
   │   • bounded retry queue; best-effort; never blocks the appliance │
   └───────────────┬─────────────────────────────────────────────────┘
                   │  aggregates + alerts only (opt-in, TLS)
                   ▼
   ┌─────────── AGGREGATOR SERVICE (new: apps/aggregator, Phase B) ───┐
   │ • tenancy: MspTenant → Customer → Site; NocUser/NocRole          │
   │ • enrollment (code → per-site credential)                        │
   │ • ingest (verify bearer+HMAC, store latest rollup + alert stream)│
   │ • dead-man detector (missing pushes → SITE_DOWN)                 │
   │ • NOC alert channels (relay: webhook/email fan-out)              │
   │ • own Postgres; own auth (NOC users)                             │
   └───────────────┬─────────────────────────────────────────────────┘
                   │ REST + realtime
                   ▼
   ┌─────────── NOC WEB UI (Phase C) ────────────────────────────────┐
   │ overview tiles (per site: health, open alerts, SLA, last-seen,  │
   │ stale) · customer grouping · alert feed · NOC channel config ·  │
   │ "drill in" → redirect to the site appliance's own URL           │
   └─────────────────────────────────────────────────────────────────┘
```

## The sovereignty contract (the crux)

The uplink emits ONLY these shapes; a **denylist-enforced serializer** builds them and a test asserts no forbidden field can appear.

- `SiteRollup` = `{ siteId, at, appliance:{version,lastBootAt?}, deviceCounts:{up,down,warning,unknown}, openAlerts:{critical,warning,info}, slaPct24h, inventory:{sites,devices,networks} }`
- `AlertUplink` = `{ siteId, at, kind:'FIRING'|'RESOLVED', severity, ruleName, opaqueDeviceRef }` where `opaqueDeviceRef` is a **hash** of the device id (like the IFC GlobalId), never the device name/IP.

**Forbidden upward (enforced denylist + test):** IP, MAC, ports, device names, network names, categories, topology/connections, SNMP community strings, raw `MonitoringMetric` series, raw `DeviceStatusEvent` rows, geocoordinates/addresses. The serializer is a pure function `buildRollup(data): SiteRollup` / `buildAlertUplink(event): AlertUplink` with a unit test that feeds a device carrying IP/MAC/name and asserts **value-absence** in the JSON (the same regression discipline used for the IFC export leak fix).

## Components + phases

### Phase A — appliance uplink (on the appliance; stacks on `feat/alerting`)
- `apps/api/src/msp/` — `MspUplinkService` (Redis-NX loop `nodescope:lock:msp_uplink`, cadence env `MSP_UPLINK_INTERVAL_SECONDS`), `rollup-builder.ts` (the sovereignty serializer + denylist test), `uplink-transport.ts` (HTTPS POST, bearer + HMAC), a bounded retry buffer. Config stored via a small `MspEnrollment` model (encrypted per-site secret) + `MSP_AGGREGATOR_URL`.
- `nodescope.sh msp-enroll <code> [--aggregator URL]` / `msp-status` / `msp-disable` (in the appliance manager).
- Off by default (no aggregator configured = no-op, like the heartbeat).
- **In-sandbox testable:** rollup-builder + denylist + transport (mocked fetch) + retry-buffer via jest; the loop via the proven Redis-NX pattern.

### Phase B — aggregator service (`apps/aggregator`, new NestJS app + own Postgres)
- **Tenancy + auth:** `MspTenant`/`Customer`/`Site`/`NocUser`/`NocRole`; NOC login (reuse better-auth or a scoped equivalent); tenant isolation on every query.
- **Enrollment:** `SiteEnrollmentCode` (one-time, `Customer`-scoped) → issues a `Site` + per-site bearer secret (hashed at rest).
- **Ingest:** `POST /ingest/rollup` — verify bearer + HMAC + site→tenant, upsert `SiteRollup` (latest) + append `SiteAlert` stream (bounded history); update `Site.lastSeenAt`.
- **Dead-man detector:** a scheduled sweep — `lastSeenAt` older than `N×cadence` → synthesize a `SITE_DOWN` NOC alert (and `SITE_RECOVERED` on the next push).
- **NOC alert channels (relay):** per-tenant `NocChannel` (webhook/email, encrypted secrets) + a delivery engine (reuse the #6 retry/backoff/notify-on-recovery design) fanning out SITE_DOWN + forwarded appliance alerts.
- **REST + realtime** for the NOC UI (overview, per-site detail, alert feed, channel CRUD).
- Deployable as its own compose stack (its own db + api + web); NOT baked into the per-site appliance compose.
- **In-sandbox testable:** all of it via jest + a real Postgres (tenancy isolation, ingest auth/HMAC, dead-man detection, channel delivery).

### Phase C — NOC web UI (`apps/noc-web` or an aggregator-served SPA)
- Overview tiles (per `Site`: health donut, open-alert badges, SLA%, last-seen, **stale** indicator when dead), grouped by `Customer`; a NOC-wide alert feed; `NocChannel` settings; a **"drill in"** button → redirect to `Site.applianceUrl`.
- Follows the same web patterns as the app UI (or a lightweight dedicated SPA — decided in the Phase C plan).

## Security / sovereignty

- The uplink is opt-in and emits only the sovereignty-safe schema (denylist + test); the appliance never sends raw telemetry.
- Per-site bearer + HMAC signing; TLS in transit; per-site secret encrypted at rest on the appliance; NOC channel secrets encrypted at rest in the aggregator.
- Aggregator tenancy isolation (a NOC user sees only their `MspTenant`'s customers/sites) enforced on every query.
- Drill-in copies nothing — it redirects to the appliance, which enforces its own F3 auth.
- The aggregator stores no raw network data; a NOC operator wanting device detail must drill into the appliance (access-controlled there).

## Non-goals

- Making the cloud the source of truth or storing raw telemetry in the cloud (hard no).
- Bidirectional control (the cloud never pushes config/commands down to appliances in v1 — read/aggregate only; remote actions are a later spec).
- Reusing the appliance `Organization` model for NOC tenancy (separate model).
- Billing/subscription management for the MSP (out of scope).
- Auto-provisioning appliances (enrollment is operator-initiated).

## Assumptions / risks

- **New deployable:** the aggregator is a whole new service (app + DB + UI) — the largest component; phased so Phase A delivers value (uplink + a minimal receiver) before the full NOC UI.
- **NOC auth:** reusing better-auth in a second app needs its own session/secret config; the Phase B plan resolves the exact auth stack.
- **Federated drill-in reachability** depends on each appliance exposing a URL (cloudflared tunnel) — captured at enrollment; a site with no tunnel is aggregate-only (no drill-in).
- The uplink reads alert data from #6 → Phase A stacks on `feat/alerting`.

## Success criteria

1. An appliance enrolled with a code pushes a sovereignty-safe `SiteRollup` + `AlertUplink[]` every cadence; a denylist test proves no IP/MAC/name/topology can appear.
2. The aggregator authenticates per-site pushes (bearer + HMAC), stores latest rollup + alert stream, and isolates tenants.
3. A site that stops pushing raises a `SITE_DOWN` NOC alert; a recovery clears it; NOC channels fan both out.
4. The NOC UI shows per-customer site tiles (health/alerts/SLA/last-seen/stale) and drills into a site's appliance URL.
5. Every layer is unit/integration tested in-sandbox (appliance uplink + aggregator against real Postgres); the aggregator deploys as its own compose stack.

## Build phasing

Full system, one spec; **built A → B → C**, each its own implementation plan:
- **Phase A** — appliance uplink (sovereignty serializer + push + enrollment client). *Stacks on `feat/alerting`.*
- **Phase B** — aggregator service (tenancy, enrollment, ingest, dead-man, NOC relay).
- **Phase C** — NOC web UI.
