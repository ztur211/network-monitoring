# Spec 9 — Agent SNMP (Credentials, OID Profiles & SNMP Collection)

- **Status:** Draft for review
- **Date:** 2026-06-12
- **Spec:** Spec 9 (Monitoring track — completes the Agent: rich SNMP metrics on the Spec 8 collector seam). Final spec of the monitoring/agent track.
- **Depends on:**
  - **Spec 8** *Public Interface* (§11) — the agent **collector seam** (`Collector`/`CollectResult`), the **device-sync `AgentDeviceDto`** (extended here with `snmp`), the agent-facing device-sync endpoint + per-agent token, and the `apps/agent` poller.
  - **Spec 7** *Public Interface* — the generic `reportMetric` / `DeviceMetric` path (SNMP metrics push through unchanged).
  - **F1a** — org tenancy, `@OrgRoles('OWNER','ADMIN')`, `NodeScopeException`, `ChangeLog`, optimistic `version`.
  - **F2/F3** — `Network`/`Device`, `PermissionsService` scope (assignment must be in the caller's scope).
  - **Added** — `net-snmp` (pure-JS) in the agent; Node `crypto` on the server.
- **Downstream consumers:** none — this completes the monitoring/agent track. The metrics it produces feed Spec 7's pipeline and Spec 4's panel (chartable via Spec 7's `/metrics`).

---

## 1. Context

Spec 8 shipped the Agent Core (reachability) with a **collector seam** and an extensible **device-sync** payload. Spec 9 adds the "richer metrics" the roadmap promised: an **SNMP collector** (v2c + v3) the agent runs alongside reachability, fed by **reusable, encrypted credential profiles** and **OID profiles** assigned per-network (device-overridable). It also introduces the project's first **secret-at-rest vault** (none exists today), since SNMP credentials must be **reversibly encrypted** — the agent needs the plaintext to poll, delivered over TLS via device-sync.

## 2. Goals

1. A `CryptoService` (AES-256-GCM) — the single encrypt/decrypt seam for secrets at rest.
2. **`SnmpCredential`** (v2c/v3, encrypted, **write-only**) + **`OidProfile`**/`OidEntry` (custom scalar OID→metric + a built-in interface-metrics flag), org-scoped.
3. **Assignment** per-`Network` with per-`Device` override, and effective-config **resolution**.
4. **Device-sync extension** — resolve + decrypt each device's SNMP target into the agent payload.
5. An agent **`snmpCollector`** (scalar GET + ifXTable walk) on Spec 8's seam, pushing generic metrics.
6. A **config UI** + endpoints to manage credentials/profiles/assignment.

## 3. Non-Goals (explicitly out of scope for Spec 9)

- **Arbitrary custom table-walk mapping** (mapping any SNMP table → per-row metrics) — v1 does **custom scalar** OIDs + a **built-in ifXTable** interface walk; generic table mapping is later.
- **SNMP traps/informs** (push from devices), **SNMP writes/SET**, **device discovery via SNMP** — read-only polling only.
- **Encryption-key rotation automation** — env key now; re-encrypt is an admin task (§14).
- **A `DeviceMetric` labels/tags column** — per-interface metrics encode `ifIndex` in the metric name; a labels column is a future Spec 7 refinement.
- **Changing Spec 8's loop / Spec 7's pipeline** — Spec 9 only registers a collector + extends the device-sync DTO + adds models/UI.
- **SNMPv1** (obsolete) — v2c + v3 only.

## 4. Architecture

Server: a `snmp` module (`apps/api/src/snmp/`) owns the credential/profile models, CRUD, assignment, and the **resolution** that feeds Spec 8's device-sync. Agent: a new `snmp-collector.ts` registered on the poller. Secrets pass **encrypted at rest → decrypted only into the device-sync payload → over TLS to the org-scoped agent**.

```
apps/api/src/common/crypto/crypto.service.ts     AES-256-GCM encrypt/decrypt
apps/api/src/snmp/
  snmp.repository.ts  snmp.service.ts             credentials + OID profiles + resolution
  snmp.controller.ts                              CRUD + assignment (OWNER/ADMIN)
apps/agent/src/snmp-collector.ts                  net-snmp scalar GET + ifXTable walk
```

## 5. Secret vault — `CryptoService`

- `encrypt(plaintext: string): string` → base64(`iv(12) ‖ authTag(16) ‖ ciphertext`); `decrypt(blob): string` → plaintext (GCM auth verifies integrity; a tampered blob throws).
- Key: 32 bytes from `SECRET_ENCRYPTION_KEY` (hex/base64 in env; required when SNMP is used). The **only** place secrets are (de)encrypted; reused by any future secret.

## 6. Data model

```prisma
enum SnmpVersion { V2C V3 }
enum SnmpSecurityLevel { NO_AUTH_NO_PRIV AUTH_NO_PRIV AUTH_PRIV }
enum SnmpAuthProtocol { MD5 SHA SHA256 }
enum SnmpPrivProtocol { DES AES AES256 }

model SnmpCredential {
  id String @id @default(uuid())
  organizationId String
  name String
  snmpVersion SnmpVersion                 // NB: distinct from the optimistic `version Int`
  securityLevel SnmpSecurityLevel?        // v3
  securityName String?                    // v3 user
  authProtocol SnmpAuthProtocol?
  privProtocol SnmpPrivProtocol?
  communityEnc String?                    // v2c — CryptoService blob
  authKeyEnc String?                      // v3 — blob
  privKeyEnc String?                      // v3 — blob
  version Int @default(1)
  createdAt DateTime @default(now())  updatedAt DateTime @updatedAt
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@index([organizationId])
}
model OidProfile {
  id String @id @default(uuid())
  organizationId String
  name String
  includeInterfaceMetrics Boolean @default(false)
  version Int @default(1)
  createdAt DateTime @default(now())  updatedAt DateTime @updatedAt
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  entries OidEntry[]
  @@index([organizationId])
}
model OidEntry { id String @id @default(uuid())  oidProfileId String  oid String  metric String
  profile OidProfile @relation(fields: [oidProfileId], references: [id], onDelete: Cascade)  @@unique([oidProfileId, oid]) }
```
- **Assignment (additive, nullable):** `Network.snmpCredentialId?` + `Network.oidProfileId?`; `Device.snmpCredentialId?` + `Device.oidProfileId?` (override). The network/device → credential and → profile relations are **`onDelete: Restrict`** — a `SnmpCredential`/`OidProfile` still assigned cannot be deleted (clear the assignment first → `SNMP_003`). Org-unique credential/profile `name` (case-insensitive, F2 raw-index precedent).
- **Resolution** (`snmp.service.resolveTarget(device)`): `credential = device.snmpCredentialId ?? device.network.snmpCredentialId`; `profile = device.oidProfileId ?? device.network.oidProfileId`. No credential ⇒ no SNMP (reachability-only).

## 7. Device-sync extension

`AgentDeviceDto` (Spec 8 §11) gains an optional `snmp`:
```
SnmpTargetDto {
  version: 'V2C' | 'V3';
  community?: string;                              // v2c (decrypted)
  securityLevel?: 'NO_AUTH_NO_PRIV'|'AUTH_NO_PRIV'|'AUTH_PRIV';
  securityName?: string; authProtocol?: string; authKey?: string; privProtocol?: string; privKey?: string;  // v3 (decrypted)
  oids: { oid: string; metric: string }[];         // custom scalar
  interfaceMetrics: boolean;                        // built-in ifXTable walk
}
```
Spec 8's agent-facing `GET /v1/monitoring/agent/devices` is extended: for each device, **resolve** the effective credential + OID profile (F3 already scopes the device list to nothing-for-agents = whole org), **decrypt** the secrets via `CryptoService`, and attach `snmp` (omitted when there's no effective credential). This is the only place secrets are decrypted; the response is TLS-only (§10).

## 8. Agent `snmpCollector`

A `Collector` (Spec 8 seam) registered beside `reachabilityCollector`; uses **`net-snmp`**:
- For a device with `snmp`: build a session (v2c `community`; or v3 `securityName` + auth/priv per `securityLevel`).
- **Scalar GET** each `oids[]` entry (+ `sysUpTime` `1.3.6.1.2.1.1.3.0`) → numeric `MetricSampleDto { deviceId, metric, value }` (Counter/Gauge/Integer/TimeTicks → number).
- If `interfaceMetrics`: **getBulk-walk the ifXTable** columns `ifHCInOctets` (`1.3.6.1.2.1.31.1.1.1.6`), `ifHCOutOctets` (`.10`), and `ifOperStatus` (`1.3.6.1.2.1.2.2.1.8`) → per-`ifIndex` metrics `if_hc_in_octets.<ifIndex>` / `if_hc_out_octets.<ifIndex>` / `if_oper_status.<ifIndex>`.
- Returns `{ checks: [], metrics }` (reachability stays the other collector). **Per-device SNMP errors** (timeout/auth/unreachable) are caught + logged → no metrics that cycle, never crashing the run. Session opened/closed per poll (v1).
- Registered in the agent poller's collector list (Spec 8 §7); it **no-ops** for devices without `snmp`, so reachability-only deployments are unaffected.

## 9. Config UI & endpoints

Server (`snmp.controller`, session, `@OrgRoles('OWNER','ADMIN')`, F3-scoped assignment):
- `POST /v1/snmp/credentials` (plaintext secrets → encrypted) · `GET /v1/snmp/credentials` (**metadata only — never secrets**) · `DELETE /v1/snmp/credentials/:id` (`SNMP_003` if assigned).
- `POST /v1/snmp/oid-profiles` (name + `includeInterfaceMetrics` + `entries[]`) · `GET` · `PATCH` · `DELETE`.
- **Assignment** via the existing `PATCH /v1/networks/:id` + `PATCH /v1/devices/:id` (accept `snmpCredentialId`/`oidProfileId`, validated to org + scope).

UI (web org settings): manage credentials (create = write-only secret entry; list shows name/version only), OID profiles (entries + interface-metrics toggle), and a per-network / per-device SNMP picker. Reuses existing settings patterns.

## 10. Security Considerations

- **Encrypted at rest, write-only in the UI:** secrets are stored only as `CryptoService` blobs; no read endpoint ever returns them; they are decrypted **only** to build the per-agent, org-scoped device-sync payload, delivered over **TLS** to a valid per-agent token. Nothing logs secrets.
- **Blast radius:** the `SECRET_ENCRYPTION_KEY` is the root secret; losing it loses the credentials (re-enter), leaking it + the DB exposes them — so the key lives only in env/secret storage, never the DB. Rotation = decrypt-with-old/encrypt-with-new sweep (§14).
- **SNMP realities:** v3 **authPriv** is recommended; **v2c community strings are plaintext on the wire** by SNMP's design — acceptable only on the trusted customer LAN the agent runs in; the UI nudges toward v3.
- **Scope:** credential/profile management is OWNER/ADMIN; assignment is F3-scoped (only in-scope networks/devices); an agent only ever receives its own org's resolved secrets.

## 11. Public Interface

This spec completes the track (no downstream consumer). Its outward contracts:
- `CryptoService` (`encrypt`/`decrypt`) — reusable for any future secret-at-rest.
- The metric shapes it emits — `<custom metric>` and `if_hc_in_octets.<ifIndex>` / `if_hc_out_octets.<ifIndex>` / `if_oper_status.<ifIndex>` — flow into Spec 7's `DeviceMetric` and are queryable via Spec 7's `/metrics` (Spec 4 can chart them later).
- `SnmpTargetDto` on `AgentDeviceDto` — the device-sync extension.

## 12. Testing (TDD — test first)

- **`CryptoService`** (unit): `decrypt(encrypt(x)) === x`; ciphertext differs each call (random IV); a tampered blob throws (GCM).
- **Credential/profile service** (integration): CRUD; the stored row's `*Enc` ≠ plaintext; `GET` responses omit every secret field; delete-while-assigned → `SNMP_003`.
- **Resolution** (integration): device override wins over network; network default applies; no credential ⇒ no target.
- **Device-sync** (e2e): the agent device list includes a **decrypted** `snmp` for an assigned device, **omits** it for an unassigned one, and a different org's agent never receives it.
- **`snmpCollector`** (agent, Vitest, **mocked `net-snmp`**): scalar GET → metrics with the profile's names; `interfaceMetrics` → per-`ifIndex` metrics named `if_hc_*` ; an SNMP error → empty metrics + no throw; v2c vs v3 session params built from the target.
- **UI** (RTL): credential create posts plaintext (write-only), OID-profile create with entries + toggle, per-network assignment.

## 13. Documentation (Rule 10 — same-commit doc updates)

- API Design Document: `/v1/snmp/*` endpoints, the `snmpCredentialId`/`oidProfileId` fields on network/device, `SNMP_003`, and the `SnmpTargetDto` device-sync extension.
- SAD/CLAUDE.md: the `CryptoService` secret vault (`SECRET_ENCRYPTION_KEY`), the SNMP credential/OID-profile model + per-network assignment, and the agent `snmpCollector`.
- `apps/agent/README.md`: SNMP collection + `net-snmp`; `deploy/README.md`: set `SECRET_ENCRYPTION_KEY`.

## 14. Open Questions (non-blocking; resolve during writing-plans / implementation)

- **Key rotation:** ship the decrypt-old/encrypt-new sweep now or defer (defer; document the manual procedure).
- **Interface labeling:** `ifIndex` in the metric name (v1) vs an `ifDescr` label — a `DeviceMetric` labels column (Spec 7 refinement) would be cleaner; revisit if cardinality/readability bites.
- **SNMP cadence:** poll SNMP every reachability cycle (v1) vs a separate, slower SNMP interval (SNMP is heavier).
- **Session pooling:** per-poll sessions (v1) vs a pooled/persistent session per device.
- **Arbitrary table mapping:** generalize the ifXTable walk to user-mapped tables (the deferred §3 capability) — gauge demand first.
- **v3 engine discovery / boot counters** — `net-snmp` handles; confirm against real gear during implementation.
