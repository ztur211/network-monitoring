# Out-of-band alerting

**Date:** 2026-07-05
**Status:** approved (brainstorm) — ready for implementation planning
**Type:** implementation spec (local-first "required change" #6)
**Parent:** `docs/design/2026-06-30-local-first-architecture-direction.md` (required change #6:
"Out-of-band alerting path. Alert delivery that survives a downed site link — cloud relay
and/or secondary channel; 'notify on recovery' fallback.")
**Builds on:** Spec 7 monitoring (on `master`). This spec's branch `feat/alerting` is off
**`master`** — independent of the appliance-packaging / off-site-backup stack.

## Context

Spec 7 monitoring already **detects** device state (`UP` / `WARNING` / `DOWN` / `UNKNOWN` — there
is no `DEGRADED`) via a pure derive-state function with anti-flap (`DOWN` only after
`downThreshold` consecutive fails). Every transition flows through a **single write path** —
`apps/api/src/monitoring/ingest/ingest.service.ts`, whose `if (changed)` branch appends a
`DeviceStatusEvent` and emits a realtime `DEVICE_STATUS` event. But NodeScope has **no alerting**:
no way to say "notify me when a device goes down." That's this spec.

A network-monitoring tool is needed most exactly when the network breaks, so alert *delivery* must
be resilient to a WAN outage. The umbrella doc's escape hatches are: (a) **notify on recovery**
(queue during the outage, deliver when the link returns), and (b) a **non-LAN path** (cloud relay
/ cellular) so someone learns the site went dark from *outside*. We deliver (a) fully locally, and
achieve (b) cheaply with a **heartbeat client** that pings a free external dead-man's-switch — no
cloud service of our own (that overlaps MSP #4, which the umbrella sequences *after* this).

## Decisions (settled in brainstorming)

- **Scope = local alert engine + resilient delivery + notify-on-recovery + a heartbeat client.**
  No cloud relay built here; the genuine "site went dark" signal comes from the appliance
  heartbeating a free external monitor (e.g. Healthchecks.io / UptimeRobot). The cloud
  aggregation/relay is MSP #4.
- **Channels = generic webhook + email (SMTP) + in-app.** The generic outgoing **webhook** is the
  free, high-leverage bridge: the operator points it at Slack / Discord / Teams / Google Chat
  (native incoming webhooks) or Zapier / Make / IFTTT / n8n free tiers (→ 6000+ apps, *including
  SMS*) or PagerDuty/Opsgenie. Email via the operator's own SMTP (free tiers). In-app reuses the
  realtime seam. We build no per-vendor (Twilio/Slack SDK) integrations — the destination is the
  operator's (free) webhook URL.
- **Triggers = device state transitions AND metric thresholds.**
- **Two phases:** **P1 = backend** (this plan's target: data model, evaluation, delivery engine,
  channels, heartbeat, REST API, migration). **P2 = web config UI + alert feed.**

## Goals / non-goals

**Goals**
- Per-org **alert rules** that fire on device down/recovery/warning and on metric thresholds, and
  route to configured **channels**.
- Delivery that survives a WAN outage: durable queue + retry/backoff; a channel that's unreachable
  during an outage delivers when it recovers ("notify on recovery"); a `RESOLVED` notice when a
  device recovers.
- A heartbeat so an external free monitor can raise "this site went dark."
- Single-node-correct AND multi-replica-correct (Redis-NX single-winner loops).

**Non-goals**
- Our own cloud relay / dead-man's-switch service (external free monitor + MSP #4).
- Per-vendor channel SDKs (Twilio SMS, Slack app) — covered by the generic webhook + operator
  free tiers.
- On-call scheduling / escalation policies / paging rotations (future).
- Changing Spec 7's derive-state / thresholds themselves (we *consume* transitions; per-org
  *rule* config is new, but the global `MONITORING_*` detection thresholds stay).
- The web UI (that's Phase 2).

---

## Phase 1 — backend

### A. Data model (per-org Prisma, encrypted secrets)

Mirrors the `SnmpCredential` pattern (org-scoped, `*Enc` columns encrypted via `CryptoService`
AES-256-GCM / `SECRET_ENCRYPTION_KEY`, `version` optimistic-lock, `@@index([organizationId])`).

- **`AlertChannel`** — `organizationId`, `type` (`WEBHOOK | EMAIL | INAPP`), `name`, `enabled`,
  and a small typed config: webhook → `url` + `secretEnc` (optional bearer/HMAC secret); email →
  `host`/`port`/`fromAddr`/`toAddrs`/`username` + `passwordEnc`; inapp → (none). Secrets live only
  in `*Enc` columns, decrypted at point-of-use, never logged.
- **`AlertRule`** — `organizationId`, `name`, `enabled`, `trigger` (`STATE_TRANSITION |
  METRIC_THRESHOLD`), a **scope** stored as a small JSON selector
  (`{all:true}` | `{deviceIds:[…]}` | `{networkIds:[…]}` | `{siteIds:[…]}`),
  `severity` (`INFO | WARNING | CRITICAL`), `channelIds String[]`,
  `cooldownSeconds` (flap suppression — min re-fire interval per device), `notifyOnRecovery Bool`.
  - STATE_TRANSITION condition: which target states fire (`DOWN`, optionally `WARNING`).
  - METRIC_THRESHOLD condition: `metric` (`latencyMs` in v1), `op` (`gt | lt`), `value`,
    `forSeconds` (must hold this long).
- **`AlertEvent`** — the durable history: `organizationId`, `ruleId`, `deviceId?`, `kind`
  (`FIRING | RESOLVED`), `severity`, `detail Json`, `dedupKey`, `createdAt`. `@@index` on
  `(organizationId, createdAt)` and `dedupKey`.
- **`AlertDelivery`** — the resilient queue, one row per (event × channel): `alertEventId`,
  `channelId`, `status` (`PENDING | SENT | FAILED | GAVE_UP`), `attempts`, `lastAttemptAt?`,
  `nextAttemptAt`, `lastError?`. `@@index([status, nextAttemptAt])`.

A migration adds these + the enums. (Prisma `enum`s per the existing convention.)

### B. Evaluation

Two evaluators, both producing `AlertEvent`s + enqueuing `AlertDelivery`s. A shared
`AlertDedupService` enforces per-(rule, device) cooldown and open/closed state (don't re-fire
while already firing; emit `RESOLVED` once on recovery).

- **State-transition evaluator.** Bind the `MONITORING_EMITTER` token to a **composite emitter**
  that fans each emit to (1) the existing `MonitoringGatewayEmitter` (unchanged realtime behavior)
  and (2) a new alert sink calling `AlertEvaluator.onStatusChange(orgId, deviceId, prev, next,
  siteId, latencyMs, at)`. The sink loads enabled `STATE_TRANSITION` rules whose scope covers the
  device, and: enters FIRING when `next` ∈ the rule's target states (respecting cooldown +
  not-already-firing); enters RESOLVED when a firing device returns to `UP` (if `notifyOnRecovery`).
  This taps the exact `if (changed)` seam with **no change to `ingest.service.ts`** — only the DI
  binding of the port it already consumes.
- **Metric-threshold evaluator.** A periodic loop (**Redis-NX single-winner lock**, copying
  `runPushScheduler`'s `redis.set(key,'1','EX',ttl,'NX')` pattern; lock key
  `nodescope:lock:alert_eval`) runs every `ALERT_EVAL_INTERVAL_SECONDS` (default 60): for each
  enabled `METRIC_THRESHOLD` rule, query recent `MonitoringMetric` (or the `MonitoringMetric_5m`
  cagg) for in-scope devices; a device whose metric breaches `op value` continuously for
  `forSeconds` → FIRING; recovery → RESOLVED. Firing state is tracked (via open `AlertEvent`s /
  `AlertDedup`) so it fires once per breach, not every tick.

### C. Delivery engine (resilient + notify-on-recovery)

A periodic loop (Redis-NX lock `nodescope:lock:alert_deliver`, every
`ALERT_DELIVER_INTERVAL_SECONDS` default 15) drains `AlertDelivery` rows with `status IN
(PENDING, FAILED)` and `nextAttemptAt <= now`, dispatches each to its channel adapter:
- success → `SENT`.
- failure → `attempts++`, `lastError`, exponential backoff `nextAttemptAt = now + base·2^attempts`
  (capped), `status = FAILED` (still retryable). After `ALERT_MAX_ATTEMPTS` (default 10, ~capped
  window) → `GAVE_UP`.
- **Notify on recovery:** a channel unreachable during a WAN outage keeps failing → the delivery
  stays retryable and **sends when the link returns** — the umbrella's local fallback. (A high max
  keeps it queued across a realistic outage.)

**Channel adapters** (a small `ChannelDispatcher` maps `type` → adapter):
- `WebhookChannel` — `POST url` a JSON payload (`{event, rule, device, state, severity, at, …}`);
  optional `Authorization: Bearer <secret>` or an HMAC signature header. Timeout + non-2xx = fail.
- `EmailChannel` — SMTP via **`nodemailer`** (new dep), TLS, using the channel's host/port/creds.
- `InAppChannel` — `emitScoped(orgId, siteId, 'v1:alert:fired'|'v1:alert:resolved', payload)` via
  the realtime gateway (new `v1:alert:*` events in `packages/shared`), so in-scope users get a
  live feed. In-app "delivery" is best-effort/fire-and-forget (marked SENT after emit).

### D. Heartbeat client

A periodic loop (`ALERT_HEARTBEAT_INTERVAL_SECONDS`, default 60; disabled if
`ALERT_HEARTBEAT_URL` unset) POSTs a compact health summary (site id, counts of up/down devices,
timestamp) to `ALERT_HEARTBEAT_URL`. Point it at a free dead-man's-switch (Healthchecks.io /
UptimeRobot / a Zapier hook); if the appliance or its WAN dies, the pings stop and that external
service alerts. Best-effort (failures logged, never fatal). Env-configured (global to the
appliance), single-winner via the same Redis-NX pattern (lock `nodescope:lock:alert_heartbeat`).

### E. REST API

`AlertModule` controllers, F3-permission-scoped to the org/site (reuse the existing guards):
- CRUD `AlertChannel` + `AlertRule` (org-scoped; secrets write-only, never returned).
- `POST /alerts/channels/:id/test` — send a synthetic test alert through the channel (validates
  config + reachability).
- `GET /alerts/events` — paginated history (filter by rule/device/kind/time).
DTOs in `@nodescope/shared`.

### F. Scheduling / single-node correctness

All three loops (metric-eval, delivery, heartbeat) use the **Redis-NX single-winner lock** so
exactly one replica runs each tick with real Redis, while the single-node in-memory Redis backing
always wins (so it just runs) — identical to the Spec-7 push scheduler. The state-transition
evaluator is event-driven (runs in whichever replica ingested the change) and is idempotent via
`AlertDedup` + `dedupKey`, so double-processing is harmless.

### G. Config (env)

`ALERT_EVAL_INTERVAL_SECONDS` (60), `ALERT_DELIVER_INTERVAL_SECONDS` (15), `ALERT_MAX_ATTEMPTS`
(10), `ALERT_HEARTBEAT_URL` (unset = off), `ALERT_HEARTBEAT_INTERVAL_SECONDS` (60). Documented in
`.env.example`.

### Phase-1 testing (all jest, in-sandbox — no Docker)

- **Unit:** derive of dedup/cooldown state; rule-scope matching (device/network/site); the
  state-transition evaluator (FIRING/RESOLVED across a prev→next matrix); the metric-threshold
  evaluator (breach-for-duration, recovery) against seeded metrics; delivery backoff/retry state
  machine + GAVE_UP; each channel adapter with a **mocked** HTTP client / SMTP transport / realtime
  gateway (assert payload + failure handling); heartbeat POST + no-op-when-unset.
- **Integration (`*.repository.spec.ts`, real DB):** the Alert repositories (CRUD, org-scoping,
  encrypted-secret round-trip) — the DB test tier already runs against Postgres in-sandbox.
- **The notify-on-recovery property:** a delivery that fails N times then succeeds ends `SENT`
  (simulated channel that flips from erroring to ok).

---

## Phase 2 — web config UI + alert feed (separate plan)

- **Channels** settings page: add/edit/test webhook/email/in-app channels (secrets write-only).
- **Rules** settings page: create a rule (scope picker · trigger · states/threshold · channels ·
  severity · cooldown · notify-on-recovery).
- **Alerts feed:** live + historical `AlertEvent`s (subscribe to the new `v1:alert:*` realtime
  events; web currently isn't wired for `DEVICE_STATUS`, so this adds the first alert subscription).
- Follows existing `apps/web` settings patterns.

---

## File inventory (Phase 1)

**Added**
- `apps/api/prisma/schema.prisma` — `AlertChannel`/`AlertRule`/`AlertEvent`/`AlertDelivery` +
  enums; a migration under `apps/api/prisma/migrations/`.
- `apps/api/src/alerts/` — module: `alerts.module.ts`; `alert-evaluator.service.ts` (state) +
  `alert-metric-evaluator.service.ts` (threshold loop); `alert-dedup.service.ts`;
  `alert-delivery.service.ts` (queue loop); `channels/{webhook,email,inapp}.channel.ts` +
  `channel-dispatcher.ts`; `alert-heartbeat.service.ts`; repositories; `alerts.controller.ts`;
  DTOs. Plus `__tests__/*.spec.ts` (+ `*.repository.spec.ts`).
- `apps/api/src/alerts/monitoring-alert.emitter.ts` — the second `MONITORING_EMITTER` sink.
- `apps/api/package.json` — add `nodemailer` (+ `@types/nodemailer`).
- `packages/shared` — Alert DTOs + `v1:alert:fired` / `v1:alert:resolved` realtime event types.

**Modified**
- `apps/api/src/monitoring/**` — bind `MONITORING_EMITTER` to a composite (gateway emitter + the
  new alert sink); DI-only change, no `ingest.service.ts` change.
- `apps/api/src/app.module.ts` — wire `AlertModule`.
- `apps/api/.env.example` — `ALERT_*` vars.

## Assumptions, dependencies, risks

- **Redis-optional interplay:** single-node uses the in-memory Redis backing (loops always run);
  multi-replica needs real Redis for single-winner — consistent with Spec 7. The state evaluator
  is idempotent regardless.
- **`nodemailer`** is a new runtime dep (SMTP). Webhook/in-app need no new deps.
- **Encryption:** channel secrets use the same `SECRET_ENCRYPTION_KEY` the API already requires.
- **Metric-threshold cost:** the eval loop queries Timescale per rule; scope + the 5-min cagg keep
  it cheap. v1 supports the `latencyMs` metric only.
- **Delivery ordering/dupes:** at-least-once (a crash between send + mark-SENT can re-send);
  acceptable for alerts, and `dedupKey` bounds duplicates.

## Success criteria (Phase 1)

1. A `STATE_TRANSITION` rule fires an `AlertEvent(FIRING)` + enqueues deliveries when an in-scope
   device goes `DOWN`, and a `RESOLVED` on recovery — proven by a jest test driving the ingest
   seam.
2. A `METRIC_THRESHOLD` rule fires when `latencyMs > value` holds for `forSeconds` and resolves
   when it recovers — proven against seeded metrics.
3. Webhook/email/in-app adapters deliver the payload; a channel that fails then recovers ends
   `SENT` (notify-on-recovery); after `ALERT_MAX_ATTEMPTS` it's `GAVE_UP`.
4. Rules/channels CRUD is org-scoped and secrets are never returned/logged; the heartbeat POSTs
   when `ALERT_HEARTBEAT_URL` is set and no-ops otherwise.
5. All loops are single-winner under real Redis and run under the single-node in-memory backing.
