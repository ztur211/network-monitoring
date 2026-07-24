# NodeScope — turnkey 3D demo (Windows)

Show off the 3D BIM viewer + live infra monitoring on a Windows machine, with the
whole backend running **locally in Docker** (single-node, no Redis, nothing leaves the
box). Two moving parts: a Docker Compose backend and the NodeScope desktop app.

## Prerequisites

- **Docker Desktop** (Windows, with the Compose v2 CLI — bundled).
- The **`NodeScope-<version>-win.zip`** desktop build (portable — no install).
- Internet on first run (Docker pulls images; the seed downloads the ~2.5 MB sample IFC).

## 1) Start the backend

From the repo root:

```powershell
docker compose `
  -f deploy/docker-compose.prod.yml `
  -f deploy/docker-compose.demo.yml `
  --env-file deploy/.env.demo `
  up -d --build
```

This brings up Postgres (TimescaleDB + PostGIS), the API (single-node, **in-memory**
Redis, **filesystem storage** — blobs on a local Docker volume, no MinIO), the web app,
and a one-shot **`demo-seed`** that seeds the org/site/building and uploads the public
**FZK-Haus** sample model into *Main Building*.

Watch the seed finish (it exits when done):

```powershell
docker compose -f deploy/docker-compose.prod.yml -f deploy/docker-compose.demo.yml logs -f demo-seed
# … [demo-seed] done — open the desktop app and view Main Building.
```

Sanity check the API is healthy and single-node:

```powershell
curl http://localhost:8080/api/health
# { "status":"ok", "services": { "redis": { "enabled":false, "mode":"in-memory", "status":"disabled" }, ... } }
```

## 2) Run the desktop app

1. Unzip `NodeScope-<version>-win.zip` and run **`NodeScope.exe`** (Windows may warn about
   an unsigned app — *More info → Run anyway*).
2. Click the gear / **Settings** and set the **API URL** to:
   ```
   http://localhost:8080/api
   ```
   Save. (The demo is single-origin: the desktop app, the browser login, and the API all
   live at `http://localhost:8080`, so sign-in cookies work.) Relaunch the app.
3. Click **Sign in** — your browser opens the NodeScope login. Sign in with the seeded
   account:
   - **Email:** `owner@acme.test`
   - **Password:** `devpassword123`
   The browser hands the session back to the desktop app automatically.
4. In the sidebar open **Acme HQ → Main Building**. The FZK-Haus renders in 3D; the right
   panel shows device health (Core Router, Firewall, …) and the Ops HUD overlays live
   up/down status on the building. Click an element to inspect its IFC properties.

## Notes

- **Single-node, no Redis:** `/health` reports `redis: disabled (in-memory)` — this is the
  local-first appliance mode (all interim state is in-process; a future multi-node MSP
  deployment adds Redis only as a SignalR backplane).
- **Data stays local:** everything is on this machine; nothing is sent to any cloud.
- **Re-seeding:** re-running `up` re-runs `demo-seed` (idempotent).
- **Stop / reset:**
  ```powershell
  docker compose -f deploy/docker-compose.prod.yml -f deploy/docker-compose.demo.yml down        # stop
  docker compose -f deploy/docker-compose.prod.yml -f deploy/docker-compose.demo.yml down -v      # stop + wipe data
  ```
- **`deploy/.env.demo`** holds throwaway localhost secrets — never use it for a real deployment.

## Building the desktop app yourself

The committed `NodeScope-*-win.zip` is a portable build. To rebuild:

- **On Windows** (produces a real installer): `npm i && npm run package:win` in `apps/desktop`
  (the `nsis` installer target works natively on Windows).
- **Cross-build from Linux** (portable zip): the `electron-builder.yml` `win` target is `zip`
  because the nsis uninstaller-signing step fails under wine; `npm run package:win` yields
  `apps/desktop/release/NodeScope-*-win.zip`.
