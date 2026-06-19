# nodescope-agent

A cross-platform reachability monitoring daemon that enrolls against a NodeScope org,
polls the devices assigned to it, and pushes results to the server's ingest endpoint.

## What it does (Phase A + Phase B — built)

### Phase A — identity and enrollment

- Reads its configuration from a JSON file and/or environment variable overrides.
- Stores its `agentId` + `token` in a credentials file (mode `0600`).
- Enrolls against the server via `POST /api/v1/monitoring/agent/enroll` and persists the
  returned credentials.

### Phase B — collect → ship loop

The agent runs a cycle on every `probeIntervalMs` interval:

1. **Sync devices** — calls `GET /v1/monitoring/agent/devices` (authenticated with
   `x-agent-token`) and retrieves the list of `AgentDeviceDto` records assigned to this
   agent.
2. **Poll (concurrency-capped)** — runs all registered `Collector`s against each device
   in parallel, capped to `concurrency` concurrent device slots via `mapLimit`.
3. **Enqueue to the offline buffer** — the merged `IngestBatchDto` (`checks` + `metrics`)
   is appended to a file-backed JSONL queue.
4. **Drain / flush to ingest** — batches are flushed one by one to
   `POST /v1/monitoring/ingest`.  If a flush call throws (server unreachable, non-2xx),
   the item is kept at the head of the queue and the drain loop stops; it retries on the
   next cycle.
5. **Heartbeat** — calls `POST /v1/monitoring/agent/heartbeat` to record liveness.

### Collector seam

The poller runs zero or more `Collector` instances per device and merges their results:

```ts
export interface Collector {
  collect(device: AgentDeviceDto): Promise<CollectResult>;
}
// CollectResult = { checks: StatusCheckDto[]; metrics: MetricSampleDto[] }
```

**Built-in: reachability collector** — runs `@nodescope/probe` TCP/ICMP probes against
`device.ipAddress`, emits one `StatusCheckDto` (ok + latency) and one `latency_ms`
`MetricSampleDto` per device.

**Spec 9 (planned):** an SNMP collector will register on this same seam and merge its own
checks and metrics into each device's batch.

### Offline buffer

The buffer is file-backed (`JSONL`, one batch per line) so batches survive process
restarts.  Behaviour:

- **Enqueue** appends a batch and immediately persists the queue file.
- **Drop-oldest cap** — if the queue exceeds `maxItems` (default 5 000) the oldest
  entries are dropped before persisting.
- **Keep on failure** — if a flush call fails during `drain`, the failing batch stays at
  position 0 and the drain loop exits; the agent retries next cycle.
- **Drain on reconnect** — as soon as the server is reachable again, each `runCycle` call
  works through all queued batches before sending the fresh batch.

## What is not yet implemented

- **Phase C (planned):** server-side agent registry, per-agent token auth guard
  (`AgentTokenGuard`), agent enrollment codes, and the ingest endpoint extension.
  The agent's HTTP calls are currently tested against **mocked** server endpoints — the
  live server routes do not exist yet.
- **Phase D (planned):** agent-facing management endpoints, management UI, OS installers,
  and end-to-end tests.
- **Spec 9 (planned):** SNMP collector (registers on the Phase B collector seam).

## Configuration

Configuration is merged in priority order: environment variable > `config.json` field > built-in default.

### `config.json`

Default path: `/etc/nodescope-agent/config.json`  
Override path via env: `NODESCOPE_AGENT_CONFIG`

```json
{
  "apiUrl": "http://localhost:3000/api",
  "syncIntervalMs": 300000,
  "probeIntervalMs": 30000,
  "concurrency": 20,
  "ports": [443, 80, 22],
  "icmpEnabled": true,
  "timeoutMs": 2000
}
```

### Environment variable overrides

| Variable | Purpose |
|---|---|
| `NODESCOPE_AGENT_CONFIG` | Path to `config.json` |
| `NODESCOPE_AGENT_API_URL` | `apiUrl` |
| `NODESCOPE_AGENT_SYNC_INTERVAL_MS` | `syncIntervalMs` |
| `NODESCOPE_AGENT_PROBE_INTERVAL_MS` | `probeIntervalMs` |
| `NODESCOPE_AGENT_CONCURRENCY` | `concurrency` |
| `NODESCOPE_AGENT_PORTS` | `ports` (comma-separated, e.g. `"443,80,22"`) |
| `NODESCOPE_AGENT_ICMP` | `icmpEnabled` (set to `"false"` to disable) |
| `NODESCOPE_AGENT_TIMEOUT_MS` | `timeoutMs` |
| `NODESCOPE_AGENT_CREDENTIALS` | Path to credentials JSON file (default `/etc/nodescope-agent/credentials.json`) |
| `NODESCOPE_AGENT_QUEUE` | Path to the offline queue JSONL file (default `/var/lib/nodescope-agent/queue.jsonl`) |
| `NODESCOPE_AGENT_ENROLL_CODE` | One-time enrollment code — if set on first run, triggers automatic enrollment before the loop starts |

## Credentials file

After enrollment the agent writes `{ agentId, token }` as JSON to a `0600` file.
The default path is `/etc/nodescope-agent/credentials.json`; override with
`NODESCOPE_AGENT_CREDENTIALS`.

## Enrollment (CLI — Phase D wiring)

The `nodescope-agent` binary is declared in `package.json` `bin` but the CLI entry
point (`src/index.ts`) handles first-run enrollment via `NODESCOPE_AGENT_ENROLL_CODE`.
When Phase D lands, a dedicated enrollment sub-command will be available:

```bash
nodescope-agent enroll --code <one-time-code> --url <api-base-url>
```

This will call `POST /api/v1/monitoring/agent/enroll`, persist credentials, and exit.

## Package dependencies

- `@nodescope/probe` — shared TCP/ICMP probe primitives (extracted in Spec 8 Phase A).
- `@nodescope/shared` — shared TypeScript DTOs (`AgentEnrollRequest`, `AgentEnrollResponse`,
  `AgentDeviceDto`, `IngestBatchDto`, `StatusCheckDto`, `MetricSampleDto`).

## Tests

```bash
npm test
```

Runs Vitest (node environment). Test files and coverage:

| Suite | Tests | What is covered |
|---|---|---|
| `config.spec.ts` | 7 | `loadConfig` defaults, file overrides, env overrides |
| `credentials.spec.ts` | 1 | `saveCredentials` / `loadCredentials` round-trip |
| `enroll.spec.ts` | 1 | `enroll` with mocked `fetch` |
| `api-client.spec.ts` | 3 | `syncDevices`, `ingest`, `heartbeat` with mocked `fetch`; `x-agent-token` header |
| `poller.spec.ts` | 4 | `reachabilityCollector`, `pollDevices` concurrency cap, `probeFromConfig` |
| `buffer.spec.ts` | 2 | Enqueue/drain round-trip, persistence across a fresh `createBuffer` call |
| `runtime.spec.ts` | 1 | `runCycle` orchestration with mocked client + buffer + probe |
