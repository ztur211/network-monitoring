# NodeScope — Local Setup (Windows + Docker)

End-to-end guide to running the **entire** NodeScope stack on a fresh machine —
the C# API, the web app, and the desktop **3D BIM viewer** — using Docker
Desktop.

Since the **Decision 11 cutover** the backend runs as the self-hosted
**appliance compose**: the ASP.NET Core API (which applies its own database
migrations on boot) behind Caddy, serving the web app **same-origin** at
`http://localhost:8080`. The API ships no CORS, so the old cross-origin
`dev:api`/`dev:web` terminal flow is gone — the appliance IS the dev backend.

Written for **Windows + PowerShell**; the same commands work on macOS/Linux with
the obvious substitutions.

## Prerequisites

- **Docker Desktop**, running (WSL2 backend on Windows)
- **Node.js 20–22** and **npm ≥ 10** — only for the Electron desktop shell
- **Git**

---

## Quick start (one command)

```powershell
.\scripts\run-desktop.ps1        # Linux/macOS/WSL:  ./scripts/run-desktop.sh
```

It generates local appliance secrets (`deploy/.env.desktop-dev`, git-ignored),
builds + starts the appliance (Postgres/TimescaleDB → API → Caddy/web), runs the
demo seed (org, users, devices, building model **and the FZK-Haus sample IFC**),
then launches the Electron 3D viewer. Sign in with `owner@acme.test` /
`devpassword123`; the browser PKCE sign-in needs a real display.

Handy flags: `-Reset` (wipe volumes, fresh DB), `-NoModel`, `-DesktopOnly`
(backend already up), `-BackendOnly` (no GUI), `-Stop`. Same flags on the `.sh`
(`--reset`, `--no-model`, `--desktop-only`, `--backend-only`, `--stop`). If
PowerShell blocks the script, run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

---

## Manual steps (what the script automates)

### 1. Appliance env file

Create `deploy/.env` (or let the script generate its own):

```powershell
copy deploy\.env.example deploy\.env
# fill in: PUBLIC_ORIGIN=http://localhost:8080, POSTGRES_PASSWORD,
# BETTER_AUTH_SECRET (openssl rand -base64 48),
# SECRET_ENCRYPTION_KEY (openssl rand -base64 32), SEED_PASSWORD
```

### 2. Build + start the appliance

```powershell
docker compose -f deploy/docker-compose.prod.yml -f deploy/docker-compose.build.yml `
  --env-file deploy/.env up -d --build --wait
```

The API container applies EF migrations before it serves (fresh DB → full
schema, including the TimescaleDB hypertables and PostGIS pieces). Confirm:
`curl http://localhost:8080/api/health`.

### 3. Seed demo data (+ the sample model)

```powershell
docker compose -f deploy/docker-compose.prod.yml -f deploy/docker-compose.build.yml `
  -f deploy/docker-compose.demo.yml --env-file deploy/.env up demo-seed
```

Idempotent one-shot. Creates the **Acme Networks** org, a property tree
(**HQ → Main Building → Ground Floor / Server Room**), 5 sample devices with
connections, a building model, and (with `SEED_SAMPLE_MODEL=true`, the demo
overlay's default) uploads the real **FZK-Haus** IFC through the API so the 3D
viewer shows actual geometry.

**Default logins:**

| Role | Email | Password |
| --- | --- | --- |
| Org owner (use this one) | `owner@acme.test` | `SEED_PASSWORD` (default `devpassword123`) |
| Platform super-admin | `admin@nodescope.test` | _(no credential; sign in as the owner for normal use)_ |

### 4. Use the product

- **Web:** open <http://localhost:8080> and sign in.
- **Desktop (3D viewer):** `npm install` once, then `npm run dev:desktop` and
  point the app at `http://localhost:8080/api`.

### Sign in on the desktop app

The desktop app authenticates **through your system browser** (PKCE):

1. In the desktop window, click **Sign in**.
2. Your browser opens the appliance's login page (`http://localhost:8080/login`).
3. Sign in as `owner@acme.test` / `devpassword123`.
4. The browser hands control back to the desktop app via the `nodescope://`
   deep link, and you land in the 3D viewport.

> **Windows dev caveat:** in dev mode the `nodescope://` protocol is registered
> to the **Electron dev binary**, not a packaged app. If the browser sign-in
> never returns to the desktop window, that registration is the usual cause — a
> packaged build (`npm run package:win --workspace=apps/desktop`) registers the
> protocol reliably. See [`apps/desktop/README.md`](./apps/desktop/README.md#auth-system-browser-pkce).

### Load your own building model

The seed already uploads the FZK-Haus sample. To load **your own** IFC, use the
desktop app: as an OWNER/ADMIN, open a building and use **"Import an IFC
model"** (empty state or viewport toolbar). For a large benchmark model there is
`npm run load-large-sample-model` (drives the same upload API over HTTP).

---

## Tests (optional)

```powershell
# The API is C# — the contract suite runs against a SEPARATE test stack
# (Postgres :5433, Redis :6380, MinIO :9100); the host migrates on boot:
docker compose -f docker-compose.test.yml up -d
scripts/run-csharp-host.sh
$env:NODESCOPE_BASE_URL="http://127.0.0.1:5199"; $env:NODESCOPE_REALTIME_TRANSPORT="signalr"
dotnet test tests/NodeScope.ContractTests

npm test --workspace=apps/desktop                # desktop unit tests (vitest)
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `api` container exits mentioning `SECRET_ENCRYPTION_KEY` | Set a real base64 32-byte key in the env file (step 1). |
| `demo-seed` → `SEED_PASSWORD env var is required` | Add `SEED_PASSWORD` to the env file you pass with `--env-file`. |
| 3D viewport is **empty** | The sample-model upload was skipped or failed (needs internet on first run) — re-run the demo-seed one-shot. |
| Desktop **Sign in** opens the browser but never returns | The appliance must be up at :8080; see the Windows dev caveat above. |
| Port 8080 already in use | Set `WEB_PORT` in the env file, and point the desktop at the new port. |
| Docker errors | Ensure Docker Desktop is running (WSL2 backend on Windows). |
| Want a clean slate | `.\scripts\run-desktop.ps1 -Reset` (wipes the stack's volumes, re-migrates, re-seeds). |

---

## Quick reference — full setup from scratch

**One command:** `./scripts/run-desktop.sh` (Linux/macOS/WSL) or
`.\scripts\run-desktop.ps1` (Windows PowerShell) — see *Quick start* above. The
manual steps:

```powershell
# appliance (backend + web, same origin):
copy deploy\.env.example deploy\.env      # then fill in the secrets (step 1)
docker compose -f deploy/docker-compose.prod.yml -f deploy/docker-compose.build.yml `
  --env-file deploy/.env up -d --build --wait
docker compose -f deploy/docker-compose.prod.yml -f deploy/docker-compose.build.yml `
  -f deploy/docker-compose.demo.yml --env-file deploy/.env up demo-seed
# desktop 3D viewer:
npm install
npm run dev:desktop                       # server URL: http://localhost:8080/api
```
