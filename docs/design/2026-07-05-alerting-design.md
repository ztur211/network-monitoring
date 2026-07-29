# Out-of-band alerting

Date: 2026-07-05  
Status: implemented in the .NET appliance  
Type: implementation record

## Context

Monitoring already derives `UP`, `WARNING`, `DOWN`, and `UNKNOWN` through one
ingest path. Alerting consumes only committed state transitions and persisted
metrics. It does not change monitoring thresholds or make ingest depend on
notification availability.

A network monitor is most useful during an outage, so delivery is durable and
retryable. A separate optional heartbeat lets an external dead-man service
detect loss of the complete appliance or its WAN path.

## Delivered behavior

- Per-organization state-transition and sustained latency-threshold rules.
- `all`, device, network, and site scope selectors.
- `INFO`, `WARNING`, and `CRITICAL` severity.
- In-app, generic webhook, and SMTP channels.
- Durable firing and resolved history.
- Durable per-channel delivery with bounded exponential backoff.
- Open-incident and cooldown state that prevents duplicate firing.
- Optional notification on recovery.
- Optional external appliance heartbeat.
- OWNER and ADMIN management through the native desktop client.

## Module boundaries

Alerting is a normal modular-monolith feature:

- `NodeScope.Modules.Alerting.Domain` owns alert enums.
- `NodeScope.Modules.Alerting.Application` owns request validation, evaluation,
  delivery state, and ports.
- `NodeScope.Modules.Alerting.Infrastructure` owns EF Core persistence, minimal
  API endpoints, channel adapters, and hosted workers.
- Cross-module monitoring and inventory needs flow through interfaces in
  `NodeScope.Platform.Abstractions`.

Monitoring invokes `IMonitoringAlertSink` after its status, metric, and event
writes commit. Alert failures are logged and never fail monitoring ingest.
Inventory implements scope resolution without exposing its persistence model.

## Persistence

The API-owned EF Core migration creates:

- `AlertChannel` with encrypted write-only secret material.
- `AlertRule` with a serialized scope and normalized channel links.
- `AlertRuleChannel` with foreign keys that prevent deleting a channel in use.
- `AlertIncident` with one row per rule and device deduplication key.
- `AlertEvent` as immutable firing and resolved history.
- `AlertDelivery` as the retry queue, unique per event and channel.

`AlertEvent` retains the rule name and uses a nullable rule foreign key so
history remains understandable after a rule is deleted. Incident changes,
event creation, and delivery enqueueing occur in one transaction. A PostgreSQL
transaction advisory lock serializes one rule/device deduplication key.

## Evaluation

### State transitions

`AlertEvaluator` receives committed monitoring transitions. It loads enabled
rules for that organization, verifies the device is in each rule scope, and
records:

- `FIRING` when the new state matches `DOWN` or `WARNING`.
- `RESOLVED` when an open incident returns to `UP` and recovery notification is
  enabled.

An open incident cannot fire repeatedly. After resolution, cooldown controls
the next permitted firing.

### Metric thresholds

`AlertMetricEvaluator` evaluates `latencyMs` rules on a configured cadence.
Sustained semantics are conservative:

- `gt` uses the minimum value in the window, so every sample must exceed the
  threshold.
- `lt` uses the maximum value in the window, so every sample must remain below
  the threshold.
- Evaluation requires both a recent sample immediately before the window and at
  least one sample inside it. A lone sample cannot claim that the threshold was
  sustained for the configured duration.

Scope resolution limits metric queries to the selected devices. The same
incident transaction provides firing, recovery, and cooldown behavior.

## Delivery

Each event enqueues one delivery per selected channel. The delivery worker
processes due `PENDING` and `FAILED` rows:

- Success becomes `SENT`.
- Failure increments attempts and schedules exponential backoff.
- The delay is capped at one hour.
- Reaching `ALERT_MAX_ATTEMPTS` becomes `GAVE_UP`.

This is at-least-once delivery. A process failure after an external send but
before the database update can produce a duplicate, which is preferable to a
lost outage notification.

Channel behavior:

- Webhook sends JSON over HTTP POST. An optional secret is used as a bearer
  token and an `X-NodeScope-Signature` HMAC-SHA256 signature.
- Email uses MailKit SMTP with automatic transport security and optional
  authentication.
- In-app sends `v1:alert:fired` or `v1:alert:resolved` only to the
  organization's OWNER and ADMIN SignalR group.

Stored secrets use the appliance `ISecretCipher`, are decrypted only while
dispatching, and are never returned by the API.

## Scheduling

Metric evaluation, delivery, and heartbeat are hosted workers. Each cycle takes
a PostgreSQL session advisory lock. This provides one active worker across API
replicas without introducing Redis to the single-node appliance. A lost
database connection releases the lock automatically.

Configuration:

| Variable | Default | Meaning |
| --- | ---: | --- |
| `ALERT_EVAL_INTERVAL_SECONDS` | 60 | Metric evaluation cadence |
| `ALERT_DELIVER_INTERVAL_SECONDS` | 15 | Delivery queue cadence |
| `ALERT_MAX_ATTEMPTS` | 10 | Terminal delivery attempt count |
| `ALERT_HEARTBEAT_URL` | empty | External dead-man POST endpoint |
| `ALERT_HEARTBEAT_INTERVAL_SECONDS` | 60 | Heartbeat cadence |

The heartbeat is disabled when its URL is empty. When enabled, it sends the
appliance name, counts of device states, and a timestamp. Failures are logged
and do not affect the API.

## API contract

All routes are under `/api/v1/alerts` and require OWNER or ADMIN:

- `POST /channels`
- `GET /channels`
- `DELETE /channels/{id}`
- `POST /channels/{id}/test`
- `POST /rules`
- `GET /rules`
- `DELETE /rules/{id}`
- `GET /events?limit=...`

Requests reject unknown fields and invalid channel, scope, trigger, threshold,
window, cooldown, and identifier values. Cross-organization identifiers fail
closed. Channel test transport failures return `ALERT_007` with
`CHANNEL_TEST_FAILED`.

## Verification

Coverage includes request validation, scope isolation, firing and recovery,
sustained greater-than and less-than thresholds, retry recovery, terminal
failure, API mapping, desktop behavior, headless Avalonia view construction,
and black-box HTTP, monitoring-ingest, and SignalR contracts.
