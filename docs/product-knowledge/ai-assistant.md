# NodeScope Assistant

The desktop client includes an assistant chat surface for troubleshooting and
NodeScope usage questions.

## Current Behavior

The current ASP.NET Core appliance runs the assistant in degraded mode. It does
not call an external AI provider and does not inspect the organization's
inventory. Each message returns a generic network troubleshooting checklist,
marks the provider as unavailable, and charges zero tokens.

The response travels over SignalR, so the desktop still exercises the streaming
chat protocol and presents a clear "AI service unavailable" banner.

## Usage Limits

The appliance reports these default limits:

- 20 messages per hour
- 100 messages per day
- 100,000 tokens per month

The in-process counters do not increment in degraded mode because no provider
work is charged.

## Conversation History

The visible transcript is held only in the running desktop client. Closing the
client discards it. "Clear conversation" clears the local transcript and makes a
best-effort request to forget matching server-side state.

The single-node appliance does not use Redis and does not persist assistant
conversations to PostgreSQL.

## Planned Capability

Provider-backed, network-aware inference is planned. Until it is implemented,
do not claim that the assistant can reason over documented devices, live
metrics, historical performance, or device configuration.
