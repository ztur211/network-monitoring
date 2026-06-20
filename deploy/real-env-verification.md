# Real-environment verification guide

A manual end-to-end checklist for the flows that **cannot run in the build sandbox**
(headless CI verifies types, units, integration, and e2e against a real DB — but it
cannot drive a desktop GUI, an external BCF tool, or a long-running agent against a
live server). Run these on a real host once before a release.

Each section ends with a **Sign-off** checklist. Endpoints below are shown relative
to the API base; the API mounts everything under the `/api` global prefix, so the
full path for a local server is `http://localhost:3000/api/v1/...`.

---

## 0. Bring up the stack

You need the API + web running against Postgres (PostGIS + TimescaleDB), Redis, and
MinIO (object storage). Two options:

**Local dev**

```bash
# infra (Postgres/Redis/MinIO) — or your native services
docker compose up -d            # repo-root docker-compose.yml
npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma

npm run dev:api                 # API  → http://localhost:3000  (prefix /api)
npm run dev:web                 # web  → http://localhost:8081
```

**Self-hosted demo stack** — see [`README.md`](./README.md)
(`deploy/docker-compose.prod.yml`, Caddy, smoke test).

Create an account in the web app and complete onboarding so you have an organization,
at least one **network**, one **property/building**, and a few **devices with IP
addresses** (the agent only syncs devices that have an `ipAddress`).

- [ ] API healthy, web loads, you can sign in
- [ ] An org with ≥1 building and ≥3 IP-addressed devices exists

---

## A. Launch the GUIs

### A1. Web GUI (Expo web)

```bash
# Point the web app at your API (it appends /api/v1 itself):
EXPO_PUBLIC_API_URL=http://localhost:3000 npm run dev:web
# open http://localhost:8081
```

- [ ] Login → map loads; documented devices render as markers
- [ ] The live "this browser" marker shows your geolocation + connection metrics
      (post-F2 it is a position/quality pulse with **no** device name/click — expected)
- [ ] Create / move / edit a device; reload — it persists
- [ ] Settings → **Agents** panel is reachable (used in section B)

### A2. Desktop GUI (Electron)

```bash
# Dev (hot reload). Desktop API URL = $VITE_API_URL, default http://localhost:3000/api
VITE_API_URL=http://localhost:3000/api npm run dev:desktop

# …or install the packaged build produced by release.yml / desktop-build.yml:
#   apps/desktop/release/*.exe   (Windows NSIS installer)
```

- [ ] App launches, you can sign in, and an organization/building loads
- [ ] The 3D viewport renders the building model; devices appear at their placements
- [ ] Selecting a device shows its detail/status panel
- [ ] Live device-status updates arrive over WebSocket (toggle a device in the web
      app or via the agent and watch the desktop update without a refresh)

---

## B. Agent: enroll → poll → status

Verifies the monitoring agent end to end. Full CLI/flow reference:
[`apps/agent/README.md`](../apps/agent/README.md).

### B1. Generate an enrollment code

In the **web app → Settings → Agents → Generate Code** (calls
`POST /v1/agents/enrollment-code`, returns a single-use code; only its hash is stored).

### B2. Enroll a host

Use a built binary (from `release.yml`, published to Spaces) **or** run from source:

```bash
# From a release binary:
./nodescope-agent enroll --code <CODE> --url http://<api-host>:3000/api

# …or from source in the repo:
npm run build --workspace=apps/agent
node apps/agent/dist/index.js enroll --code <CODE> --url http://localhost:3000/api
```

Expected: credentials (`{ agentId, token }`) written to the credentials file
(`/etc/nodescope-agent/credentials.json` by default, `0600`). Enrollment hits
`POST /v1/monitoring/agent/enroll`.

- [ ] Enroll exits 0 and writes credentials
- [ ] The agent appears in **Settings → Agents** within one heartbeat
      (`POST /v1/monitoring/agent/heartbeat` updates `lastSeenAt`)

### B3. Run the daemon and watch the poll loop

```bash
# Foreground, fast intervals for the test:
NODESCOPE_AGENT_PROBE_INTERVAL_MS=10000 ./nodescope-agent
# or install as a service: apps/agent/scripts/install-{linux.sh,macos.sh,windows.ps1}
```

Each cycle: sync (`GET /v1/monitoring/agent/devices`, `x-agent-token`) → probe
(reachability via `@nodescope/probe`) → enqueue → flush (`POST /v1/monitoring/ingest`)
→ heartbeat.

- [ ] Device **status** turns reachable/unreachable in the web map + desktop
      (point a device at a known-up vs known-down IP to see both)
- [ ] Device **metrics** (latency) chart populates over a few cycles
- [ ] **Offline buffer:** stop the API, let ≥1 cycle run (agent logs keep-on-failure),
      restart the API → buffered batches drain and status catches up
- [ ] **Revoke** the agent in Settings → its token stops working (`401` on next sync)

---

## C. BCF round-trip with Solibri / BIMcollab

Verifies `.bcfzip` import/export interop with external BCF 2.1 tools. Routes:
`GET /v1/buildings/:propertyId/bcf/export`, `POST /v1/buildings/:propertyId/bcf/import`
(multipart `file`, ≤50 MB).

### C1. Author issues in NodeScope (desktop)

- [ ] In the desktop viewport, **Issues** panel → *Create issue from view* — frames a
      viewpoint (camera + optional selected device) and a snapshot, posts a topic
- [ ] Add a comment to a topic; confirm it appears live (realtime) on a second client

### C2. Export → open in the external tool

```bash
# Auth with your session cookie/bearer; saves <propertyId>-issues.bcfzip
curl -fL -H "Authorization: Bearer <token>" \
  "http://localhost:3000/api/v1/buildings/<propertyId>/bcf/export" \
  -o issues.bcfzip
```

- [ ] Open `issues.bcfzip` in **Solibri** (BCF import) — topics, statuses, assignees,
      comments, and viewpoints (camera + component selection) load correctly
- [ ] Repeat in **BIMcollab** (ZOOM or the BIMcollab web) — same fidelity
- [ ] Snapshots render on the viewpoints; selected device(s) highlight via IfcGuid

### C3. Modify externally → import back

In Solibri/BIMcollab: change a topic status, add a comment, add a new topic with a
viewpoint; export a fresh `.bcfzip` from that tool.

```bash
curl -fL -H "Authorization: Bearer <token>" \
  -F "file=@modified.bcfzip" \
  "http://localhost:3000/api/v1/buildings/<propertyId>/bcf/import"
```

- [ ] Import succeeds (`200`, returns a summary); a malformed/oversized zip is
      rejected cleanly (`422`/`400`, no partial state)
- [ ] The externally-changed status/comment and the **new** topic appear in NodeScope
- [ ] **GUID stability:** a topic exported, modified, and re-imported updates in place
      (matched by GUID) rather than duplicating
- [ ] Device links re-derive from viewpoint component IfcGuids after import

---

## Release sign-off

- [ ] Section A (web + desktop GUIs) — all boxes
- [ ] Section B (agent enroll → poll → status) — all boxes
- [ ] Section C (BCF round-trip, both tools) — all boxes
- [ ] `release.yml` ran on the tag: agent binaries (linux/macOS/windows) + desktop
      installer attached to the GitHub Release; agent binaries in Spaces
- [ ] An install script (`apps/agent/scripts/install-*`) installs from the published
      `--binary-url` and enrolls on a clean host

> macOS agent binary is ad-hoc signed (runs; not notarized). `install-macos.sh`
> fetches it with `curl` (not quarantined). A browser-downloaded copy needs
> `xattr -d com.apple.quarantine ./nodescope-agent`. Windows binary/installer are
> unsigned → SmartScreen warns on first run. See `release.yml` to wire real signing.
