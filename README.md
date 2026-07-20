# NodeScope

Enterprise platform for documenting and operating physical network infrastructure. Teams map their devices, connections, circuits, and fiber runs on a GIS map **and inside per-building 3D BIM models (IFC)**, with real-time metrics, AI-assisted troubleshooting, agent-based monitoring, multi-floor support, and team/site permissions.

The stack spans a NestJS API, an Expo / React-Native-Web app (GIS + management UI), an Electron desktop client (the 3D BIM viewport), and a cross-platform monitoring agent. See `docs/PRD.md` for full requirements.

---

## Local Setup

> 📘 **For the complete, tested walkthrough — including the desktop 3D BIM viewer — see [`SETUP.md`](./SETUP.md).** The steps below are the quick reference.

### 1. Install dependencies

```bash
npm install
```

`.npmrc` at the repo root sets `legacy-peer-deps=true`. This is required because React Native 0.85's strict `react@^19.2.3` peer conflicts with Better Auth's flexible peer ranges, and because some companion packages (`expo-router`, `react-native`, `react-native-worklets`) are listed as root devDependencies purely to force them to hoist to the root `node_modules`. `expo-router` and `react-native-worklets` are there so `babel-preset-expo` can `require.resolve` them from its own hoisted location; `react-native` is there because `react-native-css-interop` (NativeWind 4's engine) calls `require("react-native/package.json")` at metro-config load and would otherwise fail with `Cannot find module 'react-native/package.json'`.

`npm install` runs `patch-package` automatically (root `postinstall` script). Patches live in `patches/` and fix upstream deprecation noise in `@react-navigation/bottom-tabs` and `@react-navigation/elements` (both packages still pass `pointerEvents` as a top-level prop, which RN-Web 0.21 deprecated). When react-navigation publishes a release that addresses this upstream, the patches will fail to apply and patch-package will warn loudly — that's the cue to delete them and bump the deps.

### 2. Copy environment file

```bash
cp .env.example .env
```

Every value has a working local default **except `SECRET_ENCRYPTION_KEY`**, which you must set or the API won't start. Generate one and paste it into `.env` as `SECRET_ENCRYPTION_KEY=…`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # or: openssl rand -base64 32
```

(`AI_BASE_URL` is only needed for the AI assistant, and must point at a local OpenAI-compatible model server such as Ollama — there is no hosted provider; `BETTER_AUTH_SECRET` and `SEED_PASSWORD` ship with working dev placeholders.) `.env` is read by the backend; the web app reads `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_MAP_TILE_STYLE_URL`, whose defaults (`http://localhost:3000`, OpenFreeMap) are what `npm run dev:web` expects.

### 3. Start local services

```bash
docker compose up -d
```

Starts PostgreSQL 16 + TimescaleDB + PostGIS (timescaledb-ha image), Redis, and MinIO (S3-compatible object storage for IFC models) on their default ports (5432, 6379, 9000/9001).

### 4. Apply database migrations

```bash
npm run db:migrate
```

Applies all migrations to `nodescope_dev` (enables `postgis`, creates the tables, adds the `Device` geometry column + `device_location_sync` trigger, the `ChangeLog` check constraint, and the 3D `BuildingModel` tables). TimescaleDB hypertable conversion and retention run at API startup via `TimescaleModule` — no manual step.

### 5. Seed demo data

```bash
npm run db:seed
```

Creates the **Acme Networks** org, the org owner **`owner@acme.test`** (password = `SEED_PASSWORD`, default `devpassword123`) and super-admin `admin@nodescope.test`, a property tree (HQ → Main Building → floors), 5 devices with connections, and a **placeholder** "Main Building" 3D model.

### 6. Run the apps

```bash
npm run dev:api       # http://localhost:3000
npm run dev:web       # http://localhost:8081
npm run dev:desktop   # Electron — the 3D BIM viewer
```

Sign in as `owner@acme.test` / `devpassword123` (on the web, or via the desktop app's browser-based sign-in — which needs `dev:web` running to serve the login page).

### 7. Load a real 3D model

The seeded model is an empty placeholder, so the 3D viewport opens blank. Load a real building:

```bash
npm run load-sample-model
```

Downloads a small public sample IFC and uploads + activates it on the Main Building. See **[`SETUP.md`](./SETUP.md)** for the full walkthrough (Windows + Docker, desktop login flow, troubleshooting).

> 💡 You can also import a model **from inside the desktop app** (no CLI): as an OWNER/ADMIN, open a building and use the **"Import an IFC model"** action on the empty state (or **Import IFC model** in the viewport toolbar) to upload + activate an `.ifc` file and reload the viewport in place.

### Tests

```bash
npm run test:unit --workspace=apps/api
docker compose -f docker-compose.test.yml up -d
npm run test:integration --workspace=apps/api
npm run test:e2e --workspace=apps/api
```

---

## Production Deployment — DigitalOcean App Platform

> **Want a free demo instead?** See **[`deploy/README.md`](./deploy/README.md)** for the self-hosted path — Docker Compose on your own Linux box, no paid cloud. The section below is the paid, managed production reference.

The platform topology is codified in [`.do/app.yaml`](./.do/app.yaml) — that file is the source of truth for which services run, how they're built, what env vars they read, and how the two domains (`api.nodescope.io`, `app.nodescope.io`) route via host-based ingress.

### One-time cloud setup

1. **Managed PostgreSQL** — create a DigitalOcean Managed PostgreSQL cluster. Enable extensions:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS timescaledb;
   ```
   Use the PgBouncer connection string from the managed panel for `DATABASE_URL`.
2. **Managed Redis** — create a DigitalOcean Managed Redis instance, copy the connection string for `REDIS_URL`.
3. **Spaces bucket** — create a bucket (used post-MVP for floor plans / Agent installers).
4. **Create the App Platform app from the spec:**
   ```bash
   doctl apps create --spec .do/app.yaml
   ```
   This creates two components in one app: the NestJS API (2 × `basic-xxs`) and the Expo Web static site. Note the returned app UUID for `DO_APP_ID`.
5. **Attach the secrets** (DATABASE_URL, REDIS_URL, BETTER_AUTH_SECRET) via the DO console or `doctl apps update <APP_ID> --spec -`. The spec declares them with empty values so the file round-trips without leaking them, but they must be set once per app.
6. **DNS** — CNAME `api.nodescope.io` and `app.nodescope.io` to the App Platform default ingress hostname (visible in the DO console after the first deploy).
7. **AI assistant** — the assistant is local-model-only (no hosted provider, no API key, no spend to cap). Set `AI_BASE_URL` to an OpenAI-compatible server reachable from the API, or leave it empty to deploy without an assistant.

### Updating the platform spec

When `.do/app.yaml` changes (new env var, instance count change, routing tweak), push to `master` and the deploy workflow re-applies the spec automatically. To force an immediate spec update without a code change:

```bash
doctl apps update <APP_ID> --spec .do/app.yaml
```

### GitHub Actions secrets

Configure these in repo settings → Secrets and variables → Actions → Production environment:

| Secret                       | Value                                                    |
| ---------------------------- | -------------------------------------------------------- |
| `PROD_DATABASE_URL`          | PgBouncer-fronted production `DATABASE_URL`              |
| `DIGITALOCEAN_ACCESS_TOKEN`  | doctl token with `apps:write` scope                      |
| `DO_APP_ID`                  | DigitalOcean App Platform app UUID                       |

### Deploy flow

1. PR merged to `main` / `master` → CI (`.github/workflows/ci.yml`) runs: lint, unit, integration, E2E, build.
2. On CI green, `.github/workflows/deploy.yml` runs four sequential jobs:
   - **wait-for-ci** — gates on the CI `Build` check passing for this SHA.
   - **migrate** — `prisma migrate deploy` against `PROD_DATABASE_URL`.
   - **deploy** — `doctl apps create-deployment --wait` triggers the App Platform rolling deploy.
   - **smoke** — `node scripts/smoke.mjs <API_URL> <WEB_URL>` exercises the auth session, CORS preflight, Socket.io handshake, web SPA shell, and SPA catchall against the freshly deployed app. Workflow fails (and surfaces the broken deploy in commit status) if any check fails. Health check is retried for ~30s to cover cold-start.

### Breaking schema change protocol

For migrations that aren't backward-compatible with the running application:

1. Deploy the migration in isolation, verify production is stable.
2. Then deploy the new application code.

Never deploy incompatible schema + code in a single release.

### Monitoring alerts (DigitalOcean dashboard)

Recommended alerts:
- CPU > 80% sustained 5 min
- Memory > 85% sustained 5 min
- Database connection pool > 80% utilization

### Bundle size budget

Web entry bundle is split via `React.lazy` in `apps/web/app/(app)/map.tsx`:

| Chunk | Raw | Gzipped | When loaded |
|---|---|---|---|
| `entry-*.js` | 1.48 MB | **416 KB** | Initial paint |
| `MapView-*.js` | 812 KB | 214 KB | First visit to the map screen |

The 500 KB gzipped initial-paint target from `CLAUDE.md` is met by the entry chunk. If a future change pushes the entry chunk over budget, the source-map attribution recipe is in `progress.md` Phase 9b under "Web bundler config + code splitting".

---

## Repository Layout

See `CLAUDE.md` for the full module-by-module breakdown and project rules.

```
nodescope/
  apps/
    api/         NestJS backend (TypeScript, strict)
    web/         React Native + Expo Web (TypeScript, strict)
    desktop/     Electron 3D BIM viewer (electron-vite; IFC viewport + node placement)
    agent/       Cross-platform monitoring daemon (enrolls + polls + pushes)
  packages/
    shared/      Types shared between api and web (incl. agent DTOs added in Spec 8)
    probe/       @nodescope/probe — shared TCP/ICMP reachability primitives (extracted Spec 8)
  docs/          PRD, SAD, API Design, DB Schema, Implementation Plan
```

## License

Proprietary — all rights reserved.
