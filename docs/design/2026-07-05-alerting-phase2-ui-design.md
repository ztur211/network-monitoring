# Out-of-band alerting phase 2: native UI

Date: 2026-07-05  
Status: implemented in the Avalonia desktop client  
Type: implementation record  
Parent: `docs/design/2026-07-05-alerting-design.md`

## Context

NodeScope has no browser surface. Alert administration and history therefore
live in the native Avalonia workspace and communicate only through appliance
HTTP and SignalR contracts.

All alert routes require OWNER or ADMIN. The desktop loads `/api/v1/access/me`
and gates the workspace before issuing alert requests. Members receive an
explanatory notice, while the API remains the authorization boundary.

## Workspace

The main workspace contains an Alerts destination with three tabs:

- Feed shows recent firing and resolved events newest first.
- Channels creates, tests, lists, and deletes notification channels.
- Rules creates, lists, and deletes alert rules.

The view model loads history, channels, and rules together. Realtime firing and
resolved events are prepended to the feed, which is capped at 200 entries.
After a SignalR reconnect, the view reloads history so events emitted during
the disconnect are not lost from the operator's view.

## Channels

The create form supports:

- Webhook: name, absolute HTTP or HTTPS URL, and optional secret.
- Email: name, SMTP host and port, sender, recipients, optional username, and
  optional password.
- In-app: name only.

Secrets are write-only. The client does not store or render them after create.
Each channel has a test action and a two-step delete confirmation. A channel
used by a rule shows a clear `CHANNEL_IN_USE` result instead of disappearing.

## Rules

The rule form supports:

- State-transition or metric-threshold trigger.
- `INFO`, `WARNING`, or `CRITICAL` severity.
- All devices, device IDs, network IDs, or site IDs.
- `DOWN` and `WARNING` state selection.
- Sustained `latencyMs` greater-than or less-than threshold.
- Cooldown and recovery notification.
- One or more selected channels.

Scope identifiers remain explicit text input in this version. The API validates
UUIDs and inventory membership while evaluation fails closed for devices
outside the selected scope.

Rules use create and delete semantics. In-place editing is intentionally absent
until the API has an optimistic-concurrency update contract.

## Client contracts

`IApplianceClient` and `ApplianceClient` expose every alert route with native
DTOs. `IRealtimeConnection` exposes strongly named fired and resolved events.
The fake appliance and fake realtime implementations cover view-model tests
without referencing server projects.

## Interaction safeguards

- Alert content is hidden until access loading completes.
- Members cannot invoke management commands.
- Create commands validate the local form and surface API validation messages.
- Destructive actions require a second click.
- Busy and error state remains visible without clearing the last successful
  feed.
- Realtime subscriptions are disposed with the workspace.

## Verification

Desktop tests cover route and envelope mapping, access gating, create and
delete flows, channel testing, realtime prepend and cap behavior, reconnect
refresh, and headless construction of each Alerts tab.

