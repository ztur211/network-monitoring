# MSP cross-site aggregation

Date: 2026-07-06  
Status: design only, pending user review  
Type: proposed future architecture

No MSP aggregation code is implemented by the reconciled branch. This document
preserves the useful intent from the historical branch while aligning it with
the current .NET appliance and native desktop product.

## Problem

Each NodeScope appliance is the source of truth for one local environment. An
MSP or internal NOC may need a central view across many appliances without
turning that central service into a copy of customer network data.

The hard sovereignty boundary is:

- Aggregates and alerts may flow upward after explicit enrollment.
- Raw metrics, logs, addresses, identifiers, names, and topology stay on the
  appliance.
- Detailed investigation connects the operator to the source appliance.

## Proposed topology

The direction under review has three parts:

1. An appliance uplink builds a compact health rollup and an alert stream.
2. A separate central ASP.NET Core service accepts authenticated site pushes,
   detects missing heartbeats, and relays NOC alerts.
3. A native NOC workspace reads the central service and opens a site's own
   appliance for detailed investigation.

The central service would have its own tenancy and database. It would not reuse
the appliance's `Organization` model.

## Proposed upward contract

Only two versioned payloads should be permitted.

`SiteRollup`:

- Site identifier
- Timestamp and appliance version
- Counts by device state
- Counts of open alerts by severity
- Aggregate SLA
- Counts of sites, devices, and networks

`AlertUplink`:

- Site identifier and timestamp
- `FIRING` or `RESOLVED`
- Severity and rule name
- Opaque hashed device reference

Forbidden fields include IP addresses, MAC addresses, ports, device and network
names, categories, topology, SNMP credentials, raw monitoring series, raw
status-event rows, coordinates, and physical addresses.

The serializer should be a pure allowlist transformation. Tests should feed it
objects containing forbidden values and verify that neither field names nor
values appear in serialized output.

## Proposed enrollment and transport

- The central service issues a one-time customer-scoped enrollment code.
- An appliance operator explicitly enrolls the appliance.
- Exchange returns a per-site identifier and secret.
- The appliance stores the secret with `ISecretCipher`.
- Pushes use TLS, bearer authentication, and an HMAC over the exact request
  body.
- A bounded durable queue retries without blocking local monitoring.
- Uplink is disabled when no central service is configured.

Federated drill-in would store a reachable appliance origin. The NOC client
would open that origin, and the operator would authenticate to the appliance
itself. The central service would not proxy or persist detailed appliance data.

## Proposed central behavior

- Independent `MspTenant`, `Customer`, `Site`, `NocUser`, and `NocRole` models.
- Tenant isolation on every query.
- Latest rollup plus bounded alert history.
- Dead-man detection when site pushes stop.
- `SITE_DOWN` and `SITE_RECOVERED` incidents.
- NOC-level webhook and SMTP channels with durable retry.
- Read-only central view in the first version.

## Phasing under review

### Phase A: appliance uplink

- Finalize the sovereignty-safe contracts.
- Implement allowlist serialization and leakage tests.
- Add explicit enrollment, status, and disable commands.
- Add authenticated, signed, durable outbound pushes.

### Phase B: central service

- Add independent tenancy and NOC authentication.
- Add enrollment and ingest.
- Add dead-man incidents and NOC delivery.
- Add central REST and realtime contracts.

### Phase C: native NOC workspace

- Customer and site overview.
- Health, alert, SLA, and stale indicators.
- Central alert feed and channel administration.
- Federated drill-in to the source appliance.

## Decisions still required

- Whether aggregation is a separate repository or another deployable in this
  solution.
- Exact NOC authentication and recovery model.
- Rollup retention and regional data residency.
- Enrollment revocation and secret rotation.
- Appliance reachability requirements for drill-in.
- Whether opaque device references are stable per site or rotate.
- Commercial and operational ownership of the central service.

Implementation should not begin until these decisions and the sovereignty
contract are reviewed and approved.

