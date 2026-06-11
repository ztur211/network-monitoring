# Spec 8 — Monitoring Agent Core (Cross-Platform Collector)

- **Status:** Draft for review
- **Date:** 2026-06-11
- **Spec:** Spec 8 (Monitoring track — second of two; the on-network agent that feeds Spec 7's ingest. **Spec 9 — Agent SNMP** adds rich-metric collection on top.)
- **Depends on:**
  - **Spec 7** *Public Interface* (§11) — the agent-agnostic ingest: `POST /v1/monitoring/ingest` (`{ checks[], metrics[] }`, `StatusCheckDto`/`MetricSampleDto`), the generic `reportMetric` path, and the token-auth pattern (extended here for **per-agent** tokens). Spec 7's `probe.ts` is **extracted to `@nodescope/probe`** and reused.
  - **F1a** *Public Interface* — org tenancy, `@OrgRoles('OWNER','ADMIN')`, `ChangeLog`, `NodeScopeException`, the `{ success, data }` envelope.
  - **F2** *Public Interface* — `Device.ipAddress` / `propertyId`.
  - **Existing** — the web-app org settings (for the management UI), the **Spaces bucket** (installer hosting, already planned).
- **Downstream consumers:** **Spec 9** (Agent SNMP — adds per-device SNMP config to device-sync and an SNMP collector to the poller seam). Read only the *Public Interface* (§11).

---

## 1. Context

Spec 7 built the server monitoring pipeline + an **embedded** prober, but managed-cloud NodeScope cannot reach a customer's private LAN. The roadmap's planned **Desktop Agent** ("a lightweight background agent for macOS, Windows, and Linux … enables monitoring of remote devices") fills that gap. Spec 8 builds the **Agent Core**: a standalone, single-binary daemon that enrolls against an org, syncs the device list, polls reachability (ICMP/TCP + latency, reusing Spec 7's probe), pushes to Spec 7's ingest with offline buffering, and runs as a cross-platform service — plus the server-side **agent registry** (enrollment, per-agent tokens, approve/revoke, last-seen).

It is the complete, shippable reachability agent. **Rich SNMP metrics** (v2c/v3, credentials, custom OID→metric mapping) are **Spec 9**, which plugs into the poller's collector seam (§7).

## 2. Goals

1. A `apps/agent` **Node/TS daemon** compiled to single per-OS binaries (`nodescope-agent-{win,linux,mac}`), reusing `@nodescope/shared` DTOs + the extracted `@nodescope/probe`.
2. **Per-agent enrollment + registry:** an `Agent` model, short-lived org **enrollment codes**, per-agent tokens, admin **approve/revoke**, and **last-seen**.
3. **Device sync → poll → push** with a **persistent offline buffer** + backoff, feeding Spec 7's ingest.
4. A **collector seam** in the poller so Spec 9 adds SNMP without restructuring.
5. Cross-platform **service installers** + a minimal **Agents management UI**.
6. A clean **Public Interface** (§11) for Spec 9.

## 3. Non-Goals (explicitly out of scope for Spec 8)

- **SNMP / rich device metrics** (v2c/v3, credential management, custom OID→metric mapping) → **Spec 9** (this spec ships the collector *seam* + reachability only).
- **Agent auto-update**, crash reporting, remote agent config push → later.
- **Per-agent site-scoping** — a Core agent monitors the **whole org's** IP'd devices; restricting an agent to certain sites is a later refinement.
- **macOS code-signing / notarization** — Windows + Linux first; mac binary builds, signing deferred.
- **A new auth system** — agents authenticate by token (not Better Auth sessions); user auth is unchanged.
- **Changing Spec 7's pipeline** — Spec 8 only *extends* ingest auth to accept a per-agent token; status model, derivation, realtime, Timescale are Spec 7's.

## 4. Architecture

Two halves: the **agent** (a client deployable) and the server **`agents` module**.

```
packages/probe/                         @nodescope/probe (extracted from Spec 7 probe.ts; shared by API prober + agent)
apps/agent/src/
  config.ts        enroll.ts            config + first-run enrollment (+ 0600 credentials file)
  api-client.ts    poller.ts  buffer.ts agent→server HTTP, poll cycle (collector seam), offline queue
  index.ts                              orchestrator / service entrypoint
apps/api/src/agents/
  agents.module.ts  agent.repository.ts
  agents.controller.ts                  management (session, OWNER/ADMIN)
  agent-ingest.controller.ts            agent-facing: enroll / devices / heartbeat
  agent-token.guard.ts                  per-agent token → { orgId, agentId }, bumps lastSeenAt
```

## 5. The agent deployable

- **Runtime/packaging:** TypeScript compiled to single per-OS binaries via **Node SEA** (or `pkg`) — mature, no separate runtime, keeps the all-Node stack + shared types. No native modules in Core (ICMP via spawning system `ping`, TCP via `node:net`; SNMP's pure-JS `net-snmp` is Spec 9). Binaries published to the **Spaces bucket**.
- **Config + secrets:** a `config.json` (`apiUrl`, `syncIntervalMs`, `probeIntervalMs`, `concurrency`, `ports`, `icmpEnabled`) + a **separate `0600` credentials file** (`agentId` + per-agent token) in the per-OS data dir. The token never sits in the config.
- **Loop (`index.ts`):** ensure enrolled → every `syncIntervalMs` refresh the device list → every `probeIntervalMs` poll all IP'd devices (concurrency-capped via the shared `mapLimit`) → enqueue results → flush the buffer to ingest → heartbeat. Graceful shutdown flushes the buffer.

## 6. Enrollment & identity

- **`Agent`** (Prisma): `id, organizationId, name, platform, version, status (PENDING|APPROVED|REVOKED), lastSeenAt, tokenHash, createdByMemberId, createdAt, updatedAt`.
- **`AgentEnrollmentCode`** (Prisma): `id, organizationId, codeHash, expiresAt, createdByMemberId, usedAt` — short-lived, single-use.
- **Flow:** an OWNER/ADMIN generates a code (UI/endpoint) → installs the agent with `nodescope-agent enroll --code <code> --url <api>` → the agent `POST`s the code → the server validates (unexpired, unused), creates the `Agent` **APPROVED** (the admin-issued code *is* the approval), marks the code used, and returns `{ agentId, token }` **once** (only the `tokenHash` is stored). Subsequent agent calls use the per-agent token. Admins **revoke** an agent (`status=REVOKED` → its token stops working).

## 7. Device sync & polling

- **`GET /v1/monitoring/agent/devices`** (per-agent token) → the org's devices that have an `ipAddress`: `{ id, name, ipAddress }` (Spec 9 extends each with SNMP config). A Core agent is **not F3-scoped** — it monitors the whole org it serves.
- **`poller.ts`** runs the **collector seam**: `collect(device) => { checks: StatusCheck[]; metrics: MetricSample[] }`. Core ships **one collector** — `reachabilityCollector` (`@nodescope/probe` `probeDevice` → an `ok`/`latencyMs` check + a `latency_ms` metric). Spec 9 registers an `snmpCollector` alongside it; the poller runs all registered collectors per device and merges their output.

## 8. Push & offline buffer

- **`buffer.ts`** — a file-backed bounded queue (append-only JSONL, size-capped with rotation/drop-oldest). Poll results enqueue; a flusher drains batches to `POST /v1/monitoring/ingest` (per-agent token). On failure (offline/5xx) it **retries with exponential backoff** and keeps the batch; on `4xx` (e.g., a revoked token → 401, or `ORG_008`) it drops the batch and logs (a revoked agent stops). Bounded so a long outage can't exhaust disk.
- `lastSeenAt` advances on every successful authed call, so the registry reflects agent health.

## 9. Server `agents` module

- **Management** (session, `@OrgRoles('OWNER','ADMIN')`): `POST /v1/agents/enrollment-code` (returns the code once + the install one-liner) · `GET /v1/agents` (list: name/platform/version/status/lastSeenAt) · `POST /v1/agents/:id/revoke` · `DELETE /v1/agents/:id`. All write `ChangeLog`.
- **Agent-facing:** `POST /v1/monitoring/agent/enroll` (code-authed, §6) · `GET /v1/monitoring/agent/devices` (§7) · `POST /v1/monitoring/agent/heartbeat` (keeps `lastSeenAt` fresh when an agent is idle with nothing to push). The last two + ingest use **`AgentTokenGuard`** — resolves the `Agent` by `tokenHash`, rejects missing/`REVOKED` (401), attaches `{ orgId, agentId }`, and bumps `lastSeenAt`.
- **Ingest extension:** Spec 7's `POST /v1/monitoring/ingest` now accepts **either** an org ingest token (Spec 7) **or** a per-agent token; with a per-agent token the `source` is `agent:<agentId>` and `lastSeenAt` updates. (One guard tries the agent token, then falls back to the org token.)

## 10. Management UI & installers

- **Agents UI** (web-app org settings, reusing existing settings patterns): generate an enrollment code (shown once + the install command), list agents (name/platform/version/**status**/**last-seen**, shown *online* if seen within ~3× sync interval else *stale*), and **revoke**. Minimal; a desktop view is later.
- **Installers** — from the single binary, per-OS service install: **Windows** (`sc.exe` / a bundled service wrapper), **Linux** (a `systemd` unit), **macOS** (a `launchd` plist), each with an install script. Binaries + scripts are published to the **Spaces bucket**; the install one-liner (from the UI) downloads, installs the service, and runs `enroll`.

## 11. Public Interface (the contract Spec 9 builds on)

- **Device-sync payload** `AgentDeviceDto { id, name, ipAddress }` — Spec 9 **adds** `snmp?: { version, credentialsRef, oids[] }`.
- **Collector seam** `Collector { collect(device): Promise<{ checks: StatusCheck[]; metrics: MetricSample[] }> }` + the poller's collector registry — Spec 9 registers `snmpCollector`.
- **Agent identity** — the `Agent` model + per-agent token + `AgentTokenGuard` (Spec 9 agents reuse it).
- **Ingest** — unchanged Spec 7 `reportMetric`/`POST /ingest` (SNMP metrics push through as generic metrics).

## 12. Security Considerations

- **Per-agent tokens, hashed at rest, individually revocable:** a compromised agent is revoked without affecting others; the org ingest token (Spec 7) remains for non-agent pushers. Enrollment codes are short-lived + single-use, so a leaked code has a small window.
- **Least privilege:** the agent reads only its org's device IPs and writes only status/metrics; it cannot read any other org data (`AgentTokenGuard` scopes to the agent's org; `deviceId`s are validated to the org in ingest → `ORG_008`).
- **Active scanning is opt-in + bounded:** the agent connects (ICMP/TCP) only to stored `Device.ipAddress` values synced from its own org, never arbitrary targets; concurrency + timeouts bound the load.
- **Credential at rest:** the per-agent token lives in a `0600` file separate from config; nothing logs it.
- **Server endpoints** are F1a-guarded (management = OWNER/ADMIN) and token-guarded (agent-facing); a `REVOKED` agent is rejected everywhere.

## 13. Testing (TDD — test first)

- **Agent (`apps/agent`, Vitest):** config load + credentials persistence; `enroll` exchange (mocked HTTP → stores `{agentId, token}`); `poller` (mocked `@nodescope/probe` + client → builds `checks`/`metrics` from synced devices via the reachability collector); `buffer` (enqueue/persist, flush batches, exponential backoff on failure, cap/rotation; **offline → grows → reconnect → drains**); the collector registry merges multiple collectors.
- **Server (`apps/api`, Jest):** enrollment-code gen + single-use/expiry; `enroll` creates an APPROVED `Agent` + returns a token once; `AgentTokenGuard` (valid → `{orgId,agentId}` + `lastSeenAt` bumped; revoked/unknown → 401); device-sync returns the org's IP'd devices (token-authed); ingest via a per-agent token sets `source='agent:<id>'` + last-seen; **revoke → subsequent agent calls 401**; management endpoints OWNER/ADMIN-gated + audited.
- **e2e:** enrollment-code → enroll → sync → ingest → the device's status appears (Spec 7) and the agent's `lastSeenAt` updates; revoke mid-stream → ingest 401.

## 14. Documentation (Rule 10 — same-commit doc updates)

- API Design Document: the `/v1/agents/*` management endpoints, the `/v1/monitoring/agent/{enroll,devices,heartbeat}` endpoints, the per-agent token path, and `AgentDeviceDto`.
- New `apps/agent/README.md` (build → single binaries, config/credentials, enroll, run-as-service) and `deploy/README.md` (installing the agent per OS from Spaces).
- SAD/CLAUDE.md: the agent deployable + the `@nodescope/probe` extraction (shared by the API prober and the agent); note Spec 9 adds SNMP on the collector seam.

## 15. Open Questions (non-blocking; resolve during writing-plans / implementation)

- **Approval policy:** auto-approve-on-valid-code (default) vs a `PENDING` state requiring explicit admin approval before data is accepted (a toggle).
- **Buffer store:** file-backed JSONL (default) vs embedded SQLite (a native module that complicates the single binary).
- **Packaging tool:** Node SEA vs `pkg` vs Bun `--compile` — pick during the agent build phase (SEA preferred for being first-party).
- **Per-agent site scope:** restricting an agent to specific sites (vs whole-org) — a later refinement if large orgs run regional agents.
- **Heartbeat vs piggyback:** whether a dedicated heartbeat is needed given `lastSeenAt` already advances on sync/ingest (could drop the heartbeat endpoint).
- **macOS signing/notarization** and **agent auto-update** — deferred.
