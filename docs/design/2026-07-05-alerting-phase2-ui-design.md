# Out-of-band alerting — Phase 2 (web UI)

**Date:** 2026-07-05
**Status:** approved-shape (Phase-1 design doc §"Phase 2"), detailed here for implementation
**Type:** implementation spec — alerting #6, Phase 2 (front-end)
**Parent:** `docs/design/2026-07-05-alerting-design.md` (§"Phase 2 — web config UI + alert feed")
**Builds on:** `feat/alerting` (Phase-1 backend: `v1/alerts` REST + `v1:alert:*` realtime events). Branch `feat/alerting-ui` is stacked **off `feat/alerting`** (it needs the Phase-1 API and the `ALERT_FIRED`/`ALERT_RESOLVED` shared events); it merges after Phase 1.

## Context

Phase 1 shipped the backend: per-org `AlertChannel`/`AlertRule` CRUD (`v1/alerts`, OWNER/ADMIN), an alert-event history (`GET /v1/alerts/events`), a test-channel endpoint, and live `v1:alert:fired` / `v1:alert:resolved` realtime events (already in `@nodescope/shared`). Nothing surfaces in the web app yet. Phase 2 makes it usable: settings pages to manage channels + rules, and a live alerts feed.

The web app (`apps/web`) is an **Expo Router / React Native Web** app: file-based routes under `app/`, a `<Tabs>` shell at `app/(app)/_layout.tsx`, NativeWind styling, Zustand stores, a single axios instance (`lib/api.service.ts`, base `…/api/v1`, cookie auth, unwraps the `{success,data}` envelope), and a shared socket.io client (`lib/websocket.service.ts` → `packages/client` `subscribe(event, handler)`). Settings live in one screen (`app/(app)/settings.tsx`) that stacks injected-client section components (`SnmpSettings.tsx` is the canonical "manage a list of org resources + create form" pattern to mirror).

**Two gaps this spec must close** (surfaced in exploration):
1. **No org-role gating exists in the web today.** The session user carries no `OrgRole`; the role lives server-side at `GET /api/v1/access/me` → `AccessSummaryDto { role }`, which the web never calls. All `v1/alerts` routes are `@OrgRoles('OWNER','ADMIN')`, so the entire alerts UI (settings **and** feed) is admin-only. We add the gating primitive: fetch `/access/me` once into an `access` store and render alerts UI only for OWNER/ADMIN.
2. **The alerts feed is the first `v1:alert:*` (and first monitoring-status) subscription in the web.** It establishes the `alert-events.service.ts` + `alerts.store.ts` pattern (mirroring `network-events.service.ts` + a Zustand store).

## Goals / non-goals

**Goals**
- An `access` store exposing the current user's `OrgRole`, loaded on app boot; a reusable admin-gate.
- **Channels** management: list + create (webhook / email / in-app, type-specific fields, secret write-only) + delete + **test**.
- **Rules** management: list + create (state-transition or metric-threshold, scope, channels, severity, cooldown, notify-on-recovery) + delete.
- An **Alerts feed**: recent `AlertEvent` history + live prepend of `v1:alert:fired`/`v1:alert:resolved`.
- Follows existing web patterns; unit-tests the testable layers (api helpers + stores).

**Non-goals**
- Editing rules/channels in place (v1 = create + delete; edit = delete/recreate — matches the SNMP settings pattern).
- Rich scope pickers with live device/site trees (v1 scope = "all devices" or a comma-separated id list; a tree picker is a follow-up).
- Component/DOM unit tests — the web has no RTL/jsdom; components are verified by `tsc` + lint + the web build, and (later) Playwright. Only `lib/` + `store/` get jest unit tests (the repo convention).
- Changing any Phase-1 backend behavior.
- SMS or other new channels (webhook already bridges Zapier/Slack/etc.).

## Design

### A. Role-gating primitive (fills gap 1)

- `lib/api.service.ts`: add `getAccessSummary(): Promise<AccessSummaryDto>` → `GET /access/me` (unwrap `data`).
- `store/access.store.ts` (Zustand, mirrors `store/auth.store.ts`): `{ role: OrgRole | null, loaded: boolean, setAccess(s), reset() }`, plus a selector/helper `isOrgAdmin(role)` = `role === 'OWNER' || role === 'ADMIN'`.
- Load once in the authenticated shell (`app/(app)/_layout.tsx`, alongside the existing session/WS boot): call `getAccessSummary()` and populate the store; on 401 the existing axios interceptor already redirects to login.
- Consumers gate on `isOrgAdmin(useAccessStore().role)`.

### B. Alert API helpers (`lib/api.service.ts`)

Thin per-endpoint async fns returning unwrapped DTOs (the SNMP-helper pattern), typed against new shared DTOs in `@nodescope/shared` (add an `alerts` DTO block there so web + api share types):
- `listChannels()` `GET /alerts/channels`; `createChannel(dto)` `POST /alerts/channels`; `deleteChannel(id)` `DELETE /alerts/channels/:id`; `testChannel(id)` `POST /alerts/channels/:id/test`.
- `listRules()` `GET /alerts/rules`; `createRule(dto)` `POST /alerts/rules`; `deleteRule(id)` `DELETE /alerts/rules/:id`.
- `listAlertEvents()` `GET /alerts/events`.
Secrets are **write-only**: channel DTOs returned from the API already omit `secretEnc` (Phase-1 redacted view); the create form sends `secret`/`password` but list never shows it.

### C. Channels settings (`components/AlertsChannels.tsx`)

Mirror `SnmpSettings.tsx`: injected `client` prop (`{ listChannels, createChannel, deleteChannel, testChannel }`) for testability; list with load/empty/error/retry; a create form whose fields switch on the selected **type** (pill toggle `WEBHOOK | EMAIL | INAPP`):
- WEBHOOK → `name`, `url`, optional `secret` (bearer).
- EMAIL → `name`, `host`, `port`, `fromAddr`, `toAddrs` (comma-separated), optional `username` + `password`.
- INAPP → `name`, optional `siteId`.
Per-row **Delete** (spinner) and **Test** (calls `testChannel`, shows success/error). Secrets never rendered in the list.

### D. Rules settings (`components/AlertsRules.tsx`)

Mirror the same section shape. Create form (plain `useState` + pill toggles, consistent with the settings sections):
- `name`; `trigger` pills (`STATE_TRANSITION | METRIC_THRESHOLD`); `severity` pills (`INFO|WARNING|CRITICAL`); `notifyOnRecovery` `<Switch>`; `cooldownSeconds` numeric.
- **scope** (v1): a `kind` pill (`all | deviceIds | siteIds | networkIds`); for the id variants, a comma-separated id text field → parsed to `string[]`. (`all` is the default; the id variants are power-user text entry — a tree picker is a non-goal.)
- Trigger-conditional fields: STATE_TRANSITION → `targetStates` pills (multi: `DOWN`, `WARNING`); METRIC_THRESHOLD → `metric` (fixed `latencyMs` v1), `op` pills (`gt|lt`), `threshold` numeric, `forSeconds` numeric.
- `channelIds`: multi-select of the org's channels (loaded via `listChannels`), rendered as toggle pills of channel names.
Per-row Delete. List shows rule name + a compact summary (trigger, scope kind, severity, channel count).

### E. Alerts feed (`app/(app)/alerts.tsx` + realtime, fills gap 2)

- `store/alerts.store.ts` (Zustand): `{ events: AlertFeedItem[], setInitial(list), prepend(item), reset() }`; `prepend` caps the list (e.g. 200) newest-first; a `RESOLVED` item is just prepended (the feed is a chronological stream of firings/resolutions, not a dedup view).
- `lib/alert-events.service.ts`: `subscribeToAlertEvents()` = `websocketService.subscribe(WS_EVENTS.ALERT_FIRED, …prepend(FIRING))` + `subscribe(WS_EVENTS.ALERT_RESOLVED, …prepend(RESOLVED))`, mirroring `network-events.service.ts`; returns a combined unsubscribe.
- Register the subscription in `app/(app)/_layout.tsx`'s boot `useEffect` (with the other subscribes; unsub in cleanup).
- `app/(app)/alerts.tsx`: on mount `listAlertEvents()` → `setInitial`; render the store's `events` newest-first (severity color, FIRING/RESOLVED badge, device pointer, rule name, time). Gate the whole screen on `isOrgAdmin`; non-admins see a "requires admin" notice (the API would 403 anyway).
- Nav: add `<Tabs.Screen name="alerts" …/>` in `_layout.tsx`, an `"alerts"` icon entry in `components/TabIcon.tsx`, hidden (`href:null`) or shown for non-admins per the gate.

### F. Wiring the settings sections

In `app/(app)/settings.tsx`, render `<AlertsChannels client={{…}} />` and `<AlertsRules client={{…}} />` alongside `<SnmpSettings/>`, wrapped so they only appear for OWNER/ADMIN (`isOrgAdmin(role)`).

### Testing (jest — `lib/__tests__` + `store/__tests__`, ESM/node, the repo convention)

- `lib/__tests__/api.service.alerts.spec.ts` — each helper calls the right path + verb and unwraps `data` (mirror `api.service.snmp.spec.ts`, mocked axios): channels list/create/delete/test, rules list/create/delete, events list.
- `lib/__tests__/api.service.access.spec.ts` — `getAccessSummary` hits `/access/me`, unwraps.
- `store/__tests__/access.store.spec.ts` — `setAccess`/`reset`; `isOrgAdmin` truth table (OWNER/ADMIN true, MEMBER/null false).
- `store/__tests__/alerts.store.spec.ts` — `setInitial`, `prepend` newest-first + cap, `reset`.
- Components (`AlertsChannels`/`AlertsRules`/`alerts.tsx`): no unit tests (no web DOM testing); verified by `tsc --noEmit` + lint + the web build passing. Playwright smoke is a later, GUI-required follow-up (noted, not in this plan).

## File inventory

**Added**
- `apps/web/store/access.store.ts`, `apps/web/store/alerts.store.ts`
- `apps/web/lib/alert-events.service.ts`
- `apps/web/components/AlertsChannels.tsx`, `apps/web/components/AlertsRules.tsx`
- `apps/web/app/(app)/alerts.tsx`
- `apps/web/lib/__tests__/api.service.alerts.spec.ts`, `…/api.service.access.spec.ts`, `apps/web/store/__tests__/access.store.spec.ts`, `…/alerts.store.spec.ts`
- `packages/shared/src/types/alerts.types.ts` (shared Alert DTOs) — or extend an existing api-types file.

**Modified**
- `apps/web/lib/api.service.ts` — alert + access helpers.
- `apps/web/app/(app)/_layout.tsx` — load access summary + register alert-event subscription + `<Tabs.Screen name="alerts">`.
- `apps/web/components/TabIcon.tsx` — `"alerts"` icon.
- `apps/web/app/(app)/settings.tsx` — render the two alert sections, admin-gated.
- `packages/shared` — export the Alert DTOs (if not already sufficient from Phase 1).

## Success criteria

1. An OWNER/ADMIN sees Channels + Rules settings and an Alerts tab; a MEMBER does not (gated on `/access/me`).
2. Creating a webhook/email/in-app channel and a state-transition or latency-threshold rule works against the Phase-1 API; secrets are never shown in any list.
3. The **Test** button delivers a synthetic alert through a channel and reports success/failure.
4. The Alerts feed shows history on load and live-prepends `v1:alert:fired`/`v1:alert:resolved` as they arrive.
5. `apps/web` unit tests (api helpers + stores) pass; `tsc` + lint + web build clean.
