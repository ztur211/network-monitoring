# NodeScope — Data-Model Overview (forward-design)

The schema the roadmap builds, **additively** across F1a→Spec 9. Database = **PostgreSQL + TimescaleDB** (`timescaledb-ha:pg16`). Every model is org-scoped (`organizationId`, `onDelete: Cascade` to `Organization`), follows F1a conventions (`version Int` for optimistic concurrency where mutable, `ChangeLog` audit, repository-only access), and is reached only through the F3 permission seam. **0 of 13 built** — this is the intended schema. (Companion: [`API-REFERENCE.md`](./API-REFERENCE.md), [`BUILD-ORDER.md`](./BUILD-ORDER.md).)

---

## Models by feature

| Feature | New models | Notable fields / relations |
|---|---|---|
| **F1a** | `Organization`, `OrganizationMember`, `OrganizationDomain`, `ChangeLog` | `OrganizationMember.userId @unique` (one org/user) + `role: OrgRole`; `User` gains `isSuperAdmin`/`tier` (self-grant-proof); `ChangeLog` = full audit (action + org + requestId + actor IP/UA + comment, kept forever) |
| **F1b** | `Invitation`, `JoinRequest` | admin invitation + domain-matched request-to-join; `JoinRequestStatus` enum |
| **F2** | `Property`, `NetworkProperty` | `Property` = org-scoped self-referencing site tree (`PropertyType` SITE/BUILDING/FLOOR/AREA, sibling-unique CI names, cycle-safe); `NetworkProperty` = the Network↔site **charter** (M2M). **`Device` becomes the Network×Site junction** (`propertyId` + `networkId` both required, optional `roleCode`); `Network.propertyId` dropped; `BROWSER_CLIENT` category retired |
| **F3** | `Team`, `TeamMember`, `TeamProperty`, `MemberProperty` | role × site-scoped assignment; teams (admin-authored, ⊆ author scope) + direct member grants, unioned; `Property` delete-blocked while assigned (`PERM_005`) |
| **Spec 1** | `BuildingModel`, `BuildingModelVersion` | per-`BUILDING` versioned IFC (immutable versions + active pointer); IFC bytes in MinIO via `StorageService`; **`Device` gains `x/y/z`** (model-local meters, nullable) |
| **Spec 2–5** | *(none)* | desktop shell / 3D viewport / nodes-in-3D are frontend; IFC export is a stateless generator over existing data |
| **Spec 7** | `DeviceStatus`, `MonitoringIngestToken` | current state (`DeviceStatusState` UP/DOWN/WARNING/UNKNOWN + latency + fail count); per-org hashed ingest token. **+ Timescale hypertables** (below) |
| **Spec 8** | `Agent`, `AgentEnrollmentCode` | per-agent registry (`AgentStatus` PENDING/APPROVED/REVOKED, hashed token, last-seen) + short-lived single-use enrollment codes |
| **Spec 9** | `SnmpCredential`, `OidProfile`, `OidEntry` | reusable encrypted (AES-256-GCM) credentials + OID profiles; **`Network` + `Device` gain `snmpCredentialId?`/`oidProfileId?`** (`onDelete: Restrict`, device overrides network) |
| **Spec 6** | `BcfTopic`, `BcfComment`, `BcfViewpoint`, `BcfTopicDevice` | BCF issues anchored to a `BUILDING` (`@@unique([organizationId, guid])` for re-import dedupe); `BcfViewpoint.camera/components` JSON; `BcfTopicDevice` links by `toIfcGuid` |

*Modified baseline models (pre-pivot 2D app):* `Device` (→ org-scoped, `propertyId`/`networkId`/`roleCode`/`x/y/z`/`snmp*`), `Network` (→ org-scoped, `snmp*`, `propertyId` dropped), plus `Circuit`/`FiberRun`/`DeviceConnection`/`User` carried forward.

## Timescale hypertables (raw SQL — not Prisma-managed)

| Table | Columns | Spec | Retention |
|---|---|---|---|
| `DeviceMetric` | `time, organizationId, deviceId, metric, value, source` (generic; `latency_ms`, `packet_loss`, `if_hc_*`, any Agent metric) | 7 | 90d |
| `DeviceStatusEvent` | `time, organizationId, deviceId, state, source` (state-transition timeline) | 7 | 365d |

## Enums

`OrgRole` (OWNER/ADMIN/MEMBER, F1a) · `ChangeAction` (F1a) · `JoinRequestStatus` (F1b) · `PropertyType` (F2) · `DeviceStatusState` (Spec 7) · `AgentStatus` (Spec 8) · `SnmpVersion`/`SnmpSecurityLevel`/`SnmpAuthProtocol`/`SnmpPrivProtocol` (Spec 9). *Baseline:* `DeviceCategory` (RAD…IOT_DEVICE/CUSTOM; `BROWSER_CLIENT` retired by F2), `DeviceMobility`.

## `ChangeLog.entityType` CHECK (accumulated, extended per migration)

`Device`, `Circuit`, `FiberRun`, `DeviceConnection` (baseline/F1a) · `Property`, `NetworkProperty` (F2) · `BuildingModel`, `BuildingModelVersion` (Spec 1) · `Team`, `TeamMember`, `TeamProperty`, `MemberProperty` (F3) · `MonitoringIngestToken` (Spec 7) · `Agent` (Spec 8) · `SnmpCredential`, `OidProfile` (Spec 9) · `BcfTopic`, `BcfComment` (Spec 6).

> Each feature's Phase-A (schema) migration appends its entity types to this CHECK via raw SQL; greenfield uses `prisma migrate reset --force`. Reconcile the exact list at each migration.

## Cross-cutting model facts

- **Org always from the session**, never the client; cross-org access → `ORG_008`.
- **Object storage** (`StorageService`, private MinIO bucket, proxied): Spec 1 building models + Spec 6 BCF snapshots.
- **Secrets at rest:** only `MonitoringIngestToken`/`Agent.tokenHash`/`SnmpCredential.*Enc` — hashed (tokens) or AES-256-GCM-encrypted (SNMP creds, via `CryptoService`, env `SECRET_ENCRYPTION_KEY`).
- **The federation key:** `toIfcGuid(device.id)` (Spec 5, shared in `@nodescope/shared`) is the stable device↔IFC-component identity used by Spec 5 export and Spec 6 BCF (`BcfTopicDevice`).
