# Spec 7 — Device Health Monitoring (Server Pipeline + Embedded Prober)

- **Status:** Draft for review
- **Date:** 2026-06-11
- **Spec:** Spec 7 (Monitoring track — first of two; the server status/metric pipeline that fills Spec 4's status seam. The on-network **Agent** that feeds it is the second, separate spec.)
- **Depends on:**
  - **Spec 4** *Public Interface* (§11) — the **status-display seam**: `NodeStatus` (`up|down|warning|unknown`), `viewportStore.setNodeStatus(deviceId, status)`, and the marker-ring/panel-badge/status-filter consumers. This spec **fills** that seam (the event + read API + the client wiring into Spec 4's device hook).
  - **F1a** *Public Interface* — org tenancy, `ChangeLog`, the `org:{organizationId}` realtime room, the `{ success, data }` envelope, `NodeScopeException`, the `ORG_*` registry.
  - **F2/F3** *Public Interface* — `governingSiteId(device) = device.propertyId`, F3 `scopeFilter` + scope-filtered reads/realtime (§8); device-status visibility follows the device's scope.
  - **Existing platform** — `Device.ipAddress`, **TimescaleDB** (`timescaledb-ha:pg16`, for hypertables), the realtime gateway, the `devices` module.
- **Downstream consumers:** the **Agent spec** (an on-network collector that pushes status + metrics to this spec's ingest seam). Read only the *Public Interface* (§11).

---

## 1. Context

Spec 4 renders device nodes in 3D with a **status-display seam** (markers/panel color + filter by `NodeStatus`), but in v1 every node is `unknown` because nothing produces health data. Spec 7 builds the **server-side monitoring pipeline** that produces it: an **agent-agnostic ingest seam**, a current-status model + **TimescaleDB** history (status events + a **generic metric** time-series), state derivation, F3-scoped reads, and a scope-filtered `v1:device:status` realtime event that drives Spec 4's `setNodeStatus`.

Because managed-cloud NodeScope cannot reach a customer's private LAN, the **collector is pluggable**. This spec ships **one minimal collector** — an **embedded ICMP/TCP prober** the server runs (for self-hosted / on-network deployments) — and the ingest contract the future **Agent** (enrollment, SNMP, installers) will push to. The prober is **off by default** (cloud uses the Agent).

## 2. Goals

1. A `DeviceStatus` current-state model + **TimescaleDB** history: a low-volume `DeviceStatusEvent` (state timeline) and a **generic `DeviceMetric`** hypertable (any named metric).
2. An **agent-agnostic ingest seam**: an in-process service (`reportStatusCheck`/`reportMetric`) + a token-authed `POST /v1/monitoring/ingest` for the Agent/external.
3. An **embedded ICMP + TCP-connect prober** (concurrency-capped scheduler), off by default, for on-network deploys.
4. **State derivation** (`UP/DOWN/WARNING/UNKNOWN`) with anti-flap thresholds.
5. **F3-scoped** status reads + a scope-filtered `v1:device:status` event that **fills Spec 4's `setNodeStatus`** seam, plus a metrics query API.
6. A clean **Public Interface** (§11) for the Agent spec.

## 3. Non-Goals (explicitly out of scope for Spec 7)

- **The on-network Agent** — enrollment/auth lifecycle, SNMP + rich interface metrics, offline buffering, packaging/installers → the **Agent spec**. This spec defines only the ingest contract it targets.
- **Alerting / notifications** (notify on down, escalation) → deferred, its own concern.
- **Cloud-side probing** — the embedded prober runs only where the server can reach devices; cloud monitoring is the Agent's job.
- **Dashboards / charts UI** beyond Spec 4's panel + the metrics query endpoint (visualization is Spec 4 / later).
- **Auth/SSO changes**; **per-device threshold authoring UI** (global/env thresholds in v1).
- **Synthetic/HTTP-content checks, traceroute, port scanning** — reachability (ICMP/TCP) + latency only in v1.

## 4. Architecture

Four layers in `apps/api/src/monitoring/`: **collection** (pluggable) → **ingestion** (the seam) → **storage + derivation** (Timescale) → **propagation** (F3-scoped realtime + read APIs → Spec 4).

```
apps/api/src/monitoring/
  monitoring.module.ts
  ingest/ingest.service.ts        reportStatusCheck() / reportMetric() — the seam
  ingest/ingest.controller.ts     POST /v1/monitoring/ingest (org-token authed)
  ingest/ingest-token.guard.ts    resolves org from the ingest token
  prober/prober.service.ts        embedded scheduler + probe loop (off by default)
  prober/probe.ts                 pure icmpProbe() / tcpProbe()
  status/device-status.service.ts state derivation + current-status reads
  status/monitoring.controller.ts GET device-status / metrics (F3-scoped)
  monitoring.repository.ts        DeviceStatus (Prisma) + hypertable $queryRaw
```

**Prober execution model (the chosen approach):** an **in-API scheduled service** — single process, fits the self-host single-container embedded model, concurrency-capped. (Rejected for v1: a separate worker container or a BullMQ/Redis job queue — both target *scale*, which is the Agent's domain.) Scheduling adds `@nestjs/schedule` (or a guarded interval).

## 5. Data Model

- **`DeviceStatus`** (Prisma, current state, 1:1 with `Device`):
```prisma
enum DeviceStatusState { UP DOWN WARNING UNKNOWN }
model DeviceStatus {
  id String @id @default(uuid())
  organizationId String
  deviceId String @unique
  state DeviceStatusState @default(UNKNOWN)
  latencyMs Float?
  consecutiveFails Int @default(0)
  lastCheckAt DateTime?  lastOkAt DateTime?  lastChangeAt DateTime?
  source String?         // 'prober' | 'agent:<id>' | 'external'
  updatedAt DateTime @updatedAt
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  device Device @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  @@index([organizationId])
}
model MonitoringIngestToken {        // per-org ingest secret (Agent/external)
  id String @id @default(uuid())
  organizationId String @unique
  tokenHash String                   // sha256(secret); secret shown once at creation
  createdAt DateTime @default(now())  updatedAt DateTime @updatedAt
}
```
- **TimescaleDB hypertables** (created via raw SQL appended to the migration — `create_hypertable(...)`; queried via `$queryRaw`, not Prisma-managed rows):
  - **`DeviceMetric`** (`time, organizationId, deviceId, metric, value double precision, source`) — generic; v1 writes `latency_ms` + `packet_loss`; the Agent pushes any metric later. Index `(deviceId, metric, time desc)`; **retention 90d**.
  - **`DeviceStatusEvent`** (`time, organizationId, deviceId, state, source`) — the state-transition timeline (written only on change → low volume). Longer retention.

`onDelete: Cascade` from `Device`/`Organization` (the Timescale hypertables key on `deviceId` text and age out via retention). The migration appends raw SQL to create the hypertables + retention and extends F1a's `ChangeLog` entity-type CHECK with `'MonitoringIngestToken'` (token (re)generation is audited; **status transitions live in `DeviceStatusEvent`, not `ChangeLog`**).

## 6. Ingestion seam

`IngestService` is the single write path; the prober and the HTTP controller both call it.
- **`reportStatusCheck({ organizationId, deviceId, ok, latencyMs?, checkedAt, source })`** — validates the device belongs to the org (`ORG_008`), updates `DeviceStatus` (`consecutiveFails`, `lastCheckAt/lastOkAt`), runs §7 derivation, appends `DeviceMetric` (`latency_ms`, `packet_loss`), and **on a state change** appends `DeviceStatusEvent` + emits `v1:device:status`.
- **`reportMetric({ organizationId, deviceId, metric, value, ts, source })`** — inserts a `DeviceMetric` row (the generic path the Agent uses for arbitrary metrics).
- **`POST /v1/monitoring/ingest`** (batch `{ checks[], metrics[] }`) — for the Agent/external; authed by the **org ingest token** (`IngestTokenGuard` resolves the org from the token, not a user session); every `deviceId` validated to that org. The embedded prober **bypasses HTTP** (calls the service in-process).

## 7. State derivation

Per check, on `DeviceStatus` (config via env, per-org override deferred):
- **UNKNOWN** — no `ipAddress`, never checked, or no check within `staleAfter` (default 3× interval — the source went quiet).
- **UP** — last check ok and `latencyMs ≤ warnLatencyMs`.
- **WARNING** — ok but `latencyMs > warnLatencyMs` (degraded).
- **DOWN** — `consecutiveFails ≥ downThreshold` (default 3 — one dropped packet won't flap).
- Defaults: `interval` 30s, `downThreshold` 3, `warnLatencyMs` 250, `staleAfter` 3×. A **state change** sets `lastChangeAt`, appends `DeviceStatusEvent`, and emits realtime; metrics append every check.

## 8. Embedded prober

`ProberService` (gated on `MONITORING_PROBER_ENABLED`, default **false**): on `MONITORING_PROBE_INTERVAL`, fetch devices with an `ipAddress`, probe **concurrency-capped** (`MONITORING_PROBE_CONCURRENCY`, default 20):
- **ICMP** first when `MONITORING_ICMP_ENABLED` and the container has `NET_RAW` (a node ICMP lib; the alternative — spawning the system `ping` — is a §15 open question); **TCP-connect** fallback to a configurable port set (`MONITORING_PROBE_PORTS`, default `[443,80,22]` — reachable if any connects).
- Each probe → `{ ok, latencyMs }` → `ingest.reportStatusCheck(...)` + `reportMetric('packet_loss', …)`. `probe.ts` (`icmpProbe`/`tcpProbe`) is isolated and unit-testable with mocked sockets.
- A self-hoster enables it; cloud leaves it off and runs the Agent.

## 9. Scoping & realtime (filling Spec 4's seam)

- **Reads** (`device-status`, `metrics`) reuse the **F3 device scope filter**: a device's status/metrics are visible iff the device is in the caller's scope (out-of-scope absent; MEMBER may **view** in scope).
- **Realtime** `v1:device:status` (`{ deviceId, state, latencyMs, at }`) is emitted to `org:{organizationId}` and **scope-filtered per the device's `governingSiteId`** (F3 §8) — same machinery as device events.
- **Spec 4 wiring (this spec adds it):** `WS_EVENTS.DEVICE_STATUS`; a `@nodescope/client.getBuildingDeviceStatus(propertyId)` method (Spec 4's `useDeviceLoad` calls it on building load → `setNodeStatus` per device); and a `v1:device:status` subscription in `useDeviceLoad` → `setNodeStatus`. Mapping `UP/DOWN/WARNING/UNKNOWN → up/down/warning/unknown`. Spec 4's markers, panel badges, and status filter then reflect live health with no Spec 4 redesign.

## 10. Read APIs

- `GET /v1/buildings/:propertyId/device-status` → `DeviceStatusDto[]` for the building's in-scope devices (Spec 4's initial load).
- `GET /v1/devices/:id/metrics?metric=latency_ms&from=&to=&bucket=5m` → Timescale `time_bucket` aggregation (scope-checked) for charts.
- `POST /v1/monitoring/ingest-token` (OWNER) → (re)generate the org ingest token, returning the secret **once**.

## 11. Public Interface (the contract the Agent spec builds on)

- **Ingest seam:** `POST /v1/monitoring/ingest` (batch `{ checks[], metrics[] }`, org-token authed) and the internal `IngestService.reportStatusCheck`/`reportMetric`. The Agent pushes here; it never writes storage directly.
- **Ingest token:** the per-org `MonitoringIngestToken` (the Agent presents it; enrollment/rotation lifecycle is the Agent spec's).
- **Status contract:** `DeviceStatusDto { deviceId, state, latencyMs, lastCheckAt, lastOkAt, lastChangeAt }`; the `v1:device:status` event; `DeviceStatusState` ↔ Spec 4 `NodeStatus`.
- **Metric contract:** the generic `DeviceMetric` shape (`metric`, `value`, `source`, `time`) + the metrics query — the Agent emits arbitrary metrics with no server change.

## 12. Security Considerations

- **Ingest token, not a user session:** the Agent/external authenticate with an org-scoped token (hashed at rest, shown once); the guard derives the org from the token, and every payload `deviceId` is validated to that org (`ORG_008`) — a token can never write another org's devices.
- **Embedded prober trust:** in-process, no token, writes only its own server's org-scoped devices; it actively connects to device IPs (ICMP/TCP) — documented, opt-in (`MONITORING_PROBER_ENABLED`), and never to arbitrary client-supplied targets (only stored `Device.ipAddress`).
- **Scope parity:** status reads + the realtime event reuse F3's filter, so a user never sees health for a device they can't see.
- **No raw metrics injection beyond numbers:** `reportMetric` accepts `(metric:string, value:number)`; values are numeric, metric names are bounded/validated.
- `NET_RAW` is the only elevated capability, only for ICMP, only on self-host opt-in; TCP-connect needs none.

## 13. Testing (TDD — test first)

- **`probe.ts`** (unit, mocked sockets/spawn): `tcpProbe`/`icmpProbe` → `{ok, latencyMs}`; timeout → `ok:false`.
- **Derivation** (`device-status.service`, unit): ok→UP; `consecutiveFails ≥ threshold`→DOWN; ok+high-latency→WARNING; stale / no-IP→UNKNOWN; transition detection.
- **`IngestService`** (integration): `reportStatusCheck` upserts `DeviceStatus` + appends a metric + emits `v1:device:status` **only on transition**; `reportMetric` inserts a hypertable row; cross-org `deviceId`→`ORG_008`.
- **Ingest token** (e2e): valid token → org resolved + 202; bad token → 401; foreign-org `deviceId` → `ORG_008`.
- **Read APIs** (e2e): `device-status` scope-filtered (out-of-scope device absent); `metrics` returns bucketed series; MEMBER may read in scope.
- **Realtime** (e2e): `v1:device:status` delivered only to in-scope sockets (F3 filter), on transition not every check.
- **Prober** (integration, mocked `probe`): iterates devices with IPs, concurrency-capped, calls ingest; **no-op when `MONITORING_PROBER_ENABLED=false`**.
- **Timescale** (integration): the migration creates the hypertables + retention; `time_bucket` query returns aggregates.

## 14. Documentation (Rule 10 — same-commit doc updates)

- Register `v1:device:status`, the `/v1/monitoring/ingest` + `/v1/monitoring/ingest-token` endpoints, the `device-status`/`metrics` reads, and the `DeviceStatusState` enum in the API Design Document; note the ingest-token auth path (distinct from user sessions).
- Update the SAD/CLAUDE.md: the monitoring pipeline (ingest seam, Timescale status/metric history, embedded prober, F3-scoped status realtime) and that the **Agent** is the next spec feeding the ingest.
- `deploy/README.md`: enabling the embedded prober (`MONITORING_PROBER_ENABLED`, `NET_RAW` for ICMP, port set) on self-host.

## 15. Open Questions (non-blocking; resolve during writing-plans / implementation)

- **TCP target:** a per-`Device` service-port field vs the default `[443,80,22]` set (default set for v1).
- **ICMP method:** a node raw-socket lib (`NET_RAW`) vs spawning the system `ping` (more portable, parses stdout) — pick during Phase prober.
- **Thresholds:** global env vs per-org override (env in v1).
- **`data-sources`/`clients` modules:** confirm whether the ingest controller/token reuses their existing patterns (check in Phase A).
- **Status audit:** whether state transitions also write `ChangeLog` (vs `DeviceStatusEvent` only) — default `DeviceStatusEvent` only; config CRUD audited.
- **Metric retention/rollups:** 90d raw; whether to add Timescale continuous-aggregate rollups for long ranges (defer).
