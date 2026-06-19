# nodescope-agent

A cross-platform reachability monitoring daemon that enrolls against a NodeScope org and
will (Phase B) poll the devices assigned to it and push results to the server's ingest
endpoint.

## What it does (Phase A — built)

- Reads its configuration from a JSON file and/or environment variable overrides.
- Stores its `agentId` + `token` in a credentials file (mode `0600`).
- Enrolls against the server via `POST /api/v1/monitoring/agent/enroll` and persists the
  returned credentials.

## What is not yet implemented

- **Phase B (planned):** device polling loop, offline buffer, push to ingest.
- **Phase C (planned):** server-side agent registry, per-agent token auth, codes, ingest
  extension.
- **Phase D (planned):** agent-facing endpoints, management UI, installers, e2e tests.

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

| Variable | Config field |
|---|---|
| `NODESCOPE_AGENT_CONFIG` | path to `config.json` |
| `NODESCOPE_AGENT_API_URL` | `apiUrl` |
| `NODESCOPE_AGENT_SYNC_INTERVAL_MS` | `syncIntervalMs` |
| `NODESCOPE_AGENT_PROBE_INTERVAL_MS` | `probeIntervalMs` |
| `NODESCOPE_AGENT_CONCURRENCY` | `concurrency` |
| `NODESCOPE_AGENT_PORTS` | `ports` (comma-separated, e.g. `"443,80,22"`) |
| `NODESCOPE_AGENT_ICMP` | `icmpEnabled` (set to `"false"` to disable) |
| `NODESCOPE_AGENT_TIMEOUT_MS` | `timeoutMs` |

## Credentials file

After enrollment the agent writes `{ agentId, token }` as JSON to a `0600` file.
The default path is `/etc/nodescope-agent/credentials.json`; use
`NODESCOPE_AGENT_CONFIG` to redirect the config, or pass an explicit path to the
`loadCredentials`/`saveCredentials` functions directly.

## Enrollment (CLI — Phase D wiring)

The `nodescope-agent` binary is declared in `package.json` `bin` but the CLI entry
point (`src/index.ts`) is not yet implemented. When Phase D lands, enrollment will be:

```bash
nodescope-agent enroll --code <one-time-code> --url <api-base-url>
```

This will call `POST /api/v1/monitoring/agent/enroll`, persist credentials, and exit.

## Package dependencies

- `@nodescope/probe` — shared TCP/ICMP probe primitives (extracted in Spec 8 Phase A).
- `@nodescope/shared` — shared TypeScript DTOs (`AgentEnrollRequest`, `AgentEnrollResponse`,
  `AgentDeviceDto`).

## Tests

```bash
npm test
```

Runs Vitest (node environment). Tests cover `loadConfig` (7 cases), `saveCredentials`/
`loadCredentials` (1 case), and `enroll` (1 case with mocked `fetch`).
