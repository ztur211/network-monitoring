# NodeScope — Local Setup (Windows + Docker)

End-to-end guide to running the **entire** NodeScope stack on a fresh machine —
the API, the web app, and the desktop **3D BIM viewer** — using Docker Desktop
for the backing services.

Written for **Windows + PowerShell**; macOS/Linux differences are called out
inline (there are only two, both in step 2). Every command below was run through
on a clean database before publishing.

> The "Local Setup" section in [`README.md`](./README.md) predates the 3D BIM
> pivot (it still references the network-mapping MVP, `dev@nodescope.io`, and
> omits the desktop app). **Use this guide instead.**

---

## What you'll have running

| Service | How it starts | Address | Purpose |
| --- | --- | --- | --- |
| PostgreSQL 16 + TimescaleDB + PostGIS | `docker compose up -d` | `localhost:5432` | primary database |
| Redis 7 | `docker compose up -d` | `localhost:6379` | cache / realtime adapter |
| MinIO (S3-compatible) | `docker compose up -d` | `localhost:9000` (API), `localhost:9001` (console) | stores uploaded IFC models |
| API (NestJS) | `npm run dev:api` | `http://localhost:3000` | REST + realtime backend |
| Web app (Expo / React-Native-Web) | `npm run dev:web` | `http://localhost:8081` | network/GIS UI **+ the login page the desktop app uses** |
| Desktop app (Electron) | `npm run dev:desktop` | native window | the 3D BIM viewport |

## Prerequisites

- **Node.js ≥ 20** and **npm ≥ 10** — check with `node -v` / `npm -v`
- **Docker Desktop**, running (WSL2 backend on Windows)
- **Git**

---

## 1. Install dependencies

```powershell
npm install
```

This is a workspace monorepo, so one install covers all apps. Notes:

- `.npmrc` sets `legacy-peer-deps=true` (required — see README for the why).
- `postinstall` runs `patch-package`, generates the Prisma client, and builds
  the `@nodescope/shared`, `@nodescope/client`, and `@nodescope/probe` packages.
  The first install takes a few minutes.

## 2. Create your `.env`

```powershell
copy .env.example .env      # macOS/Linux:  cp .env.example .env
```

Every value in `.env.example` has a working **local** default **except one you
must set**: `SECRET_ENCRYPTION_KEY`. The API refuses to start while it's the
placeholder. Generate a real 32-byte base64 key:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# macOS/Linux alternative:  openssl rand -base64 32
```

Paste the output into `.env`:

```
SECRET_ENCRYPTION_KEY=<the value you just generated>
```

That's the only required edit. (`ANTHROPIC_API_KEY` is only needed if you want
to exercise the AI assistant; everything else works with the defaults, which
match `docker-compose.yml`.)

## 3. Start the backing services

```powershell
docker compose up -d
```

Brings up Postgres, Redis, and MinIO with the credentials/ports the defaults
expect. Confirm they're healthy before continuing:

```powershell
docker compose ps
```

(The `nodescope` storage bucket is created automatically by the API/seed — no
manual MinIO step.)

## 4. Create the database schema

```powershell
npm run db:migrate
```

Applies all migrations to the `nodescope_dev` database. (TimescaleDB hypertable
conversion and retention run automatically at API startup — no manual step.)

## 5. Seed demo data

```powershell
npm run db:seed
```

Creates the demo organization **Acme Networks**, its users, a property tree
(**HQ → Main Building → Ground Floor / Server Room**), 5 sample devices with
connections, and a **placeholder** "Main Building" 3D model.

**Default logins:**

| Role | Email | Password |
| --- | --- | --- |
| Org owner (use this one) | `owner@acme.test` | `devpassword123` |
| Platform super-admin | `admin@nodescope.test` | _(super-admin; sign in as the owner for normal use)_ |

The owner password is `SEED_PASSWORD` from your `.env` (default `devpassword123`).

## 6. Run the apps

Use **three terminals** (all from the repo root):

```powershell
npm run dev:api       # http://localhost:3000
npm run dev:web       # http://localhost:8081
npm run dev:desktop   # opens the Electron window
```

### Sign in on the web app

Open <http://localhost:8081>, sign in as `owner@acme.test` / `devpassword123`.

### Sign in on the desktop app

The desktop app authenticates **through your system browser** (PKCE), so the web
app must be running:

1. In the desktop window, click **Sign in**.
2. Your browser opens. If you're not already signed in, you'll land on the web
   app's login page (`http://localhost:8081/login`) — this is why `dev:web` must
   be running.
3. Sign in as `owner@acme.test` / `devpassword123`.
4. The browser hands control back to the desktop app via the `nodescope://`
   deep link, and you land in the 3D viewport.

> **Windows dev caveat:** in dev mode the `nodescope://` protocol is registered
> to the **Electron dev binary**, not a packaged app. If the browser sign-in
> never returns to the desktop window, that registration is the usual cause — a
> packaged build (`npm run package:win --workspace=apps/desktop`) registers the
> protocol reliably. See [`apps/desktop/README.md`](./apps/desktop/README.md#auth-system-browser-pkce).

## 7. Load a real building model (don't skip this)

The seeded "Main Building" model is a **placeholder** — a valid IFC *header* with
no geometry — so the 3D viewport opens to an **empty** state. Load a real model
into it:

```powershell
npm run load-sample-model
```

This downloads a small public sample IFC (the **FZK Haus** test house, ~2.5 MB,
from the same `web-ifc` engine the viewer uses) and uploads + activates it on the
Main Building **through the API** — exactly what the desktop app's upload does.

Reopen the **Main Building** in the desktop (or web) viewer and you'll see real
geometry — walls, floors, a roof.

To load **your own** IFC instead of the sample:

```powershell
node scripts/load-sample-model.mjs path\to\your-model.ifc
```

---

## Tests (optional)

```powershell
npm run test:unit  --workspace=apps/api          # no services needed
npm run test:integration --workspace=apps/api    # needs Postgres + MinIO (above)
npm test --workspace=apps/desktop                # vitest (main + renderer)
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| API exits at startup mentioning `SECRET_ENCRYPTION_KEY` | You left the placeholder. Set a real base64 key (step 2). |
| `db:seed` → `SEED_PASSWORD env var is required` | Run it from the **repo root**, and make sure `.env` exists there. |
| 3D viewport is **empty** | That's the placeholder model — run `npm run load-sample-model` (step 7). |
| Desktop **Sign in** opens the browser but never returns | Make sure both `dev:api` (3000) and `dev:web` (8081) are running; see the Windows dev caveat in step 6. |
| `load-sample-model` can't reach the API | The API (`npm run dev:api`) must be running; it logs in as `owner@acme.test`, so `db:seed` must have run. |
| Port already in use (5432/6379/9000/3000/8081) | Stop the conflicting service, or change the mapping in `docker-compose.yml` / `PORT` in `.env`. |
| Docker errors | Ensure Docker Desktop is running (WSL2 backend on Windows). |
| Want a clean slate | `npm run db:reset` (drops, re-migrates, re-seeds), then re-run `npm run load-sample-model`. |

---

## Quick reference — full setup from scratch

```powershell
npm install
copy .env.example .env
# edit .env: set SECRET_ENCRYPTION_KEY to:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
docker compose up -d
npm run db:migrate
npm run db:seed
# three terminals:
npm run dev:api
npm run dev:web
npm run dev:desktop
# then, to see a real building in the 3D viewer:
npm run load-sample-model
```
