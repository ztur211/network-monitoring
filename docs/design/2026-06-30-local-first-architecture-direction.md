# Architecture direction: local-first, on-prem server for teams & MSPs

**Date:** 2026-06-30
**Status:** direction agreed (discussion) — umbrella doc; individual changes get their own specs
**Type:** architecture decision / direction (not a single implementation spec)
**Supersedes:** the implicit "deploy to a cloud PaaS (DigitalOcean App Platform) as the
primary target" assumption baked into `deploy.yml`.

## Why this came up

NodeScope is a **network/infrastructure monitoring** product. A monitoring tool is most
needed exactly when the network is broken — including during an internet/WAN outage. If the
source of truth (API + database) lives in the cloud, a WAN outage blinds the operator at the
precise moment they need visibility into their LAN. A network-monitoring product whose
dashboard goes dark when the network breaks is failing at its one job.

Separately, the target users are **IT teams** and **MSPs**, who need the *whole team* to
access shared monitoring data over the LAN. That rules out an embedded per-machine database
(no shared source of truth, no concurrent multi-user access).

These two forces point at the same architecture, which also happens to be the $0-hosting
answer to the cost constraint we were chasing: **a local-first, on-prem shared server.**

## Core decision

**The source of truth is a per-site server on the customer's LAN.** Clients are thin and
connect to it over the LAN; the cloud, if present at all, is a thin *optional* layer that
holds as little raw network data as possible.

- **Clients are thin, not authoritative.** The web app (browser) and desktop app (Electron)
  talk to the site server over the LAN. They may keep local caches / offline-queues for
  resilience — these already exist (`apps/web/store/offline-queue.ts`, the agent's on-disk
  buffer in `apps/agent/src/buffer.ts`) — but they are not the source of truth.
- **The server is a shared on-prem appliance.** API + Postgres(+PostGIS) + object storage
  (Redis optional) run on a box on the site LAN and ARE the source of truth. The whole team
  reaches it over LAN; it keeps working during an internet outage because it is local to what
  it monitors. "Baked into the software" means the *server ships as a drop-in appliance*
  (a Docker-compose / VM image / installer), **not** that the DB lives on anyone's laptop.
  The bones of this already exist in `deploy/docker-compose.prod.yml`.
- **Agents run on the LAN and report to the *local* site server** (not the cloud). The agent
  already buffers to disk and replays on reconnect, so brief agent↔server blips are tolerated.

This is the standard on-prem-appliance pattern of serious network tools (PRTG, LibreNMS,
Zabbix, UniFi Network Server): install on-site, clients connect over LAN, cloud optional.

## Guiding principles

1. **Data sovereignty.** Network logs are sensitive — they expose topology, device IPs/MACs,
   traffic patterns, SNMP community strings. They must be able to **never leave the building**.
   This is the same ethos the product already enforces with its hard rule that *exports carry
   zero network data*; local-first is that principle applied to the live store. The cloud
   should hold no raw network telemetry — only aggregates/health, and only by opt-in.
2. **The cloud is optional and minimal.** Only three things genuinely must cross the WAN, and
   each is opt-in: (a) remote access for off-site team members, (b) **encrypted** off-site
   backup, (c) MSP cross-site aggregation + alerting. Everything else stays on the LAN.
3. **Offline tolerance lives at the edges already** — finish the thought by making the core
   (server) local too. The agent disk-buffer and web offline-queue are evidence the team
   already designed for flaky connectivity.
4. **Out-of-band alerting.** A purely-local brain can *detect* an outage but can't *deliver*
   an alert that must travel over the dead link. So alert delivery needs an escape hatch
   (cloud relay, cellular/secondary WAN, or "notify on recovery"). This is the one capability
   that legitimately wants a non-LAN path — for MSPs it is essential.

## Topology

### IT team (one org, one site)
One server on the org's LAN + RBAC for the team. NodeScope already has orgs, site-scoped
(F3) permissions, and teams, so this is mostly the appliance-packaging work below.

### MSP (one operator, many client sites)
A **server per client site** (each client's logs stay on *their* LAN, survive *their*
outages, satisfy sovereignty), plus a **central MSP "pane of glass."** Design rule for the
central layer: **sync health / status / aggregates / alerts upward — never raw logs.** The
NOC sees rollups and drills into a specific site's server on demand. A site going offline
makes its tile stale; the rest keep working. This rides on the existing org model
(orgs = MSP tenants) and the agent/report pattern.

```
  [devices] ──probe── [agent(s)] ──LAN──▶ [SITE SERVER: API + Postgres(+PostGIS) + storage]
                                              ▲   │
                              LAN ────────────┘   │ (opt-in, aggregates/alerts only)
                         [web + desktop clients]  ▼
                                          [optional cloud: remote-access relay,
                                           encrypted backup, MSP aggregation + alerting]
```

## Required architecture changes (each becomes its own spec)

1. **Bless on-prem deployment as primary.** Package the site server as a clean appliance
   (harden `docker-compose.prod.yml`; one-command install; sane LAN defaults). Cloud deploy
   (`deploy.yml` → DigitalOcean) becomes optional/secondary or is retired.
2. **Remove the TimescaleDB hard dependency** (see the separate Timescale analysis). It is a
   scale/ops optimization, not a correctness requirement, and dropping it makes the server far
   easier to package and run on commodity on-prem hardware. Replace `time_bucket` with
   `date_bin`, drop the (already-optional) continuous aggregate, and add an explicit
   **retention job** (`DELETE … WHERE time < …`) to manage on-prem log volume.
3. **Make the server's services LAN-friendly / self-contained.** Object storage must have a
   LAN-local answer (bundle MinIO in the compose, or use local filesystem storage — note the
   prod compose currently has no storage service). Make **Redis optional** for single-node /
   small-site installs (it currently backs realtime presence + rate limiting + the conn-org
   index).
4. **MSP central aggregation layer (the main new build).** A thin service each site pushes a
   health/aggregate summary to; a NOC overview UI; per-site drill-in. Syncs aggregates +
   alerts only, never raw logs. Designed to degrade gracefully when a site is unreachable.
5. **Encrypted off-site backup.** Optional client-side-encrypted DB backup to S3-compatible
   storage (pgBackRest/Litestream → R2/B2). Backups are network data leaving the building, so
   encryption is mandatory — consistent with the sovereignty rule.
6. **Out-of-band alerting path.** Alert delivery that survives a downed site link (cloud relay
   and/or secondary channel; "notify on recovery" fallback).
7. **CI on a self-hosted runner** (already specced separately, 2026-06-30) — unrelated to
   runtime architecture but part of the same "own our infra, pay nothing" direction.

## Open decisions (not yet decided — to resolve before the relevant specs)

- **MSP central layer: federated vs aggregated.** Does the NOC *remote into* each site server
  on demand (simplest, no central store, but needs per-site reachability), or does each site
  *push* a health summary to an always-on central aggregator (better overview, more to build)?
  Leaning: aggregator for a real MSP, federated for a small one — possibly support both.
- **Is the MSP aggregator the *only* cloud component, or do we also offer a hosted
  remote-access relay** so a single team can view their own site from off-site without exposing
  the server? (`cloudflared` in the prod compose already covers most of this.)
- **Appliance form factor / where the box lives:** dedicated mini-PC appliance per site, a VM
  on the customer's hardware, or a container on their existing server. MSPs typically want a
  standardized small appliance.
- **Backup target & cadence**, and whether backup is on by default or opt-in.

## Non-goals

- Embedding the database into each client machine as a source of truth (rejected: no shared
  team access, no single source of truth).
- Making the cloud the source of truth, or storing raw network telemetry in the cloud.
- A full local-first CRDT/sync engine between clients — clients stay thin; the LAN server is
  authoritative. (Sync, if any, is site-server → central aggregator, of aggregates only.)

## Decomposition / next steps

This is the umbrella. Each "required change" above is its own brainstorm → spec → plan cycle.
Likely order: (2) drop TimescaleDB and (3) self-contained services first (they unblock clean
on-prem packaging), then (1) appliance packaging, then (5)/(6) backup + alerting, then (4) the
MSP aggregation layer as the larger enterprise build.
