# NodeScope AI Assistant

The AI Assistant helps with two things: network troubleshooting and NodeScope usage guidance.

## What the AI Knows

- Your documented devices, connections, fiber runs, and circuits (from your NodeScope data)
- Current connection quality metrics from your browser session
- Your account tier and available features
- NodeScope product documentation

## What the AI Does Not Know

- Real-time status of devices not monitored by an agent (desktop agent is a planned future feature)
- Data from devices the browser cannot reach
- Your network's historical performance beyond the current session
- Internal configurations of your network devices (routers, switches) unless you tell it

## Rate Limits

- 20 messages per hour per account
- 100 messages per day per account
- Monthly token budget (tracked across all messages)

When you approach a limit, the AI will warn you in its response. When you hit a cap, you'll see a friendly message explaining when it resets — not a raw error.

## Conversation History

Conversations are stored in memory (Redis) for 24 hours. They are not saved to a database — they are ephemeral by design for privacy. Starting a new conversation discards the previous one.

## When the AI Service is Unavailable

If the AI service is temporarily unreachable, the assistant will respond with helpful guidance based solely on your documented network data — no AI-generated content, but still useful context.
