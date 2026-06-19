# nodescope-agent

A cross-platform reachability monitoring daemon that enrolls against a NodeScope org,
polls the devices assigned to it, and pushes results to the server's ingest endpoint.

**Spec 8 Agent Core is COMPLETE** — enrollment + sync + poll + push + heartbeat;
server-side agent registry + management UI + per-agent token auth. Spec 9 (SNMP
collector) is the next spec.

---

## What it does

### Enrollment and identity (Phase A)

- Reads configuration from a JSON file and/or environment variable overrides.
- Stores `agentId` + `token` in a credentials file (mode `0600`).
- Enrolls against the server via `POST /api/v1/monitoring/agent/enroll` using a
  one-time enrollment code generated in the web app and persists the returned credentials.

### Collect → ship loop (Phase B)

The agent runs a cycle on every `probeIntervalMs` interval:

1. **Sync devices** — calls `GET /v1/monitoring/agent/devices` (authenticated with
   `x-agent-token`) and retrieves the list of `AgentDeviceDto` records assigned to
   this agent.
2. **Poll (concurrency-capped)** — runs all registered `Collector`s against each device
   in parallel, capped to `concurrency` concurrent device slots via `mapLimit`.
3. **Enqueue to the offline buffer** — the merged `IngestBatchDto` (`checks` + `metrics`)
   is appended to a file-backed JSONL queue.
4. **Drain / flush to ingest** — batches are flushed one by one to
   `POST /v1/monitoring/ingest`. If a flush call throws (server unreachable, non-2xx),
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

**Spec 9 (planned):** an SNMP collector will register on this same seam and merge its
own checks and metrics into each device's batch.

### Offline buffer

The buffer is file-backed (`JSONL`, one batch per line) so batches survive process
restarts. Behaviour:

- **Enqueue** appends a batch and immediately persists the queue file.
- **Drop-oldest cap** — if the queue exceeds `maxItems` (default 5 000) the oldest
  entries are dropped before persisting.
- **Keep on failure** — if a flush call fails during `drain`, the failing batch stays at
  position 0 and the drain loop exits; the agent retries next cycle.
- **Drain on reconnect** — as soon as the server is reachable again, each `runCycle`
  call works through all queued batches before sending the fresh batch.

---

## Building

### CJS bundle (single file, no Node.js installation required on target)

```bash
npm run build:bundle
# Output: dist/nodescope-agent.cjs
node dist/nodescope-agent.cjs --version
```

Uses esbuild to bundle the entire agent + dependencies into one CommonJS file.
The version string is injected at build time via `--define:__AGENT_VERSION__=`.

### SEA binary (single executable, no Node.js required)

```bash
npm run build:bin
# Output: dist/nodescope-agent  (Linux)  or  dist/nodescope-agent.exe  (Windows)
./dist/nodescope-agent --version
```

Uses the Node.js Single Executable Application (SEA) feature. The binary embeds the
bundled CJS blob so it runs with no external runtime. Warnings from `postject` about
missing `.note` sections are harmless on most Linux distributions.

---

## Installing

Per-OS installer scripts live in `apps/agent/scripts/`. They all take `--url` (your
NodeScope API base URL) and `--code` (the one-time enrollment code generated in the
web app under Settings → Agents → Generate Code).

### Linux (systemd)

```bash
sudo ./scripts/install-linux.sh --url https://your-nodescope-host/api --code <code>
```

Downloads (or copies from `dist/`) the binary to `/usr/local/bin/nodescope-agent`,
installs a systemd unit (`nodescope-agent.service`), runs `nodescope-agent enroll`,
and starts + enables the service.

### macOS (launchd)

```bash
sudo ./scripts/install-macos.sh --url https://your-nodescope-host/api --code <code>
```

Installs the binary, writes a launchd plist
(`/Library/LaunchDaemons/com.nodescope.agent.plist`), enrolls, and loads the daemon.

### Windows (NSSM / Task Scheduler)

```powershell
.\scripts\install-windows.ps1 -Url https://your-nodescope-host/api -Code <code>
```

Installs the binary, creates a Windows service (or Scheduled Task), enrolls, and starts
the service.

In CI / automated deployments, release binaries are published to the Spaces bucket
by the CI workflow; the installer scripts download from there when `--binary-url` is
provided.

---

## CLI reference

```
nodescope-agent [command] [options]

Commands:
  (none)   Run as daemon (default)
  enroll   Enroll this host against the NodeScope server and exit

Options:
  --version, -v   Print version and exit
  enroll --code <code> --url <api-url>
                  Exchange the one-time enrollment code for a per-agent token,
                  save credentials to /etc/nodescope-agent/credentials.json, exit.
```

### Enrollment

```bash
# Explicit enroll subcommand (recommended):
nodescope-agent enroll --code <one-time-code> --url https://your-host/api

# Automatic on first daemon start (env var):
NODESCOPE_AGENT_ENROLL_CODE=<code> nodescope-agent
```

After enrollment the binary persists `{ agentId, token }` to the credentials file and
the daemon loop begins. The agent appears in the web app's Agents list within one
heartbeat interval.

---

## Configuration

Configuration is merged in priority order: environment variable > `config.json` field >
built-in default.

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

---

## Tests

```bash
npm test
```

Runs Vitest (node environment). 8 suites, 30 tests.

| Suite | Tests | What is covered |
|---|---|---|
| `config.spec.ts` | 7 | `loadConfig` defaults, file overrides, env overrides |
| `credentials.spec.ts` | 1 | `saveCredentials` / `loadCredentials` round-trip |
| `enroll.spec.ts` | 1 | `enroll` with mocked `fetch` |
| `api-client.spec.ts` | 3 | `syncDevices`, `ingest`, `heartbeat` with mocked `fetch`; `x-agent-token` header |
| `poller.spec.ts` | 4 | `reachabilityCollector`, `pollDevices` concurrency cap, `probeFromConfig` |
| `buffer.spec.ts` | 2 | Enqueue/drain round-trip, persistence across a fresh `createBuffer` call |
| `runtime.spec.ts` | 1 | `runCycle` orchestration with mocked client + buffer + probe |
| `cli.spec.ts` | 11 | `parseArgs`, `runCli` enroll + version + daemon paths |

---

## Package dependencies

- `@nodescope/probe` — shared TCP/ICMP probe primitives (extracted in Spec 8 Phase A).
- `@nodescope/shared` — shared TypeScript DTOs (`AgentEnrollRequest`, `AgentEnrollResponse`,
  `AgentDeviceDto`, `IngestBatchDto`, `StatusCheckDto`, `MetricSampleDto`).

---

## What is next

- **Spec 9:** SNMP collector (registers on the Phase B collector seam); adds SNMP-based
  checks and metrics per device without changing the agent's core poll/push loop.
