# NodeScope

Enterprise platform for documenting and operating physical network infrastructure. Teams map their devices, connections, circuits, and fiber runs on a GIS map **and inside per-building 3D BIM models (IFC)**, with real-time metrics, AI-assisted troubleshooting, agent-based monitoring, multi-floor support, and team/site permissions.

The stack is mid-migration to C#/.NET (see the migration decision log): an ASP.NET Core API (`src/`, EF Core + SignalR, owns the schema), a NativeAOT monitoring agent (`src/NodeScope.Agent`), and - until the native desktop client ships - the transition-era Expo / React-Native-Web app (served same-origin by the appliance) and Electron 3D BIM viewer. See `docs/PRD.md` for full requirements.

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

(`BETTER_AUTH_SECRET` and `SEED_PASSWORD` ship with working dev placeholders.)

### 3. Start local services

```bash
docker compose up -d
```

Starts PostgreSQL 16 + TimescaleDB + PostGIS (timescaledb-ha image), Redis, and MinIO on their default ports (5432, 6379, 9000/9001).

### 4. Run the API (migrates on boot) and seed

```bash
DATABASE_URL=postgresql://nodescope:localdevpassword@localhost:5432/nodescope_dev \
STORAGE_ENDPOINT=http://localhost:9000 scripts/run-csharp-host.sh     # API on :5199

# one-shot seed (idempotent; add SEED_SAMPLE_MODEL=true to also upload a real IFC):
DATABASE_URL=postgresql://nodescope:localdevpassword@localhost:5432/nodescope_dev \
SEED_PASSWORD=devpassword123 dotnet run --project src/NodeScope.Api -- seed
```

The host applies EF migrations before serving (fresh DB → full schema; a
Node-era DB is baselined). The seed creates the **Acme Networks** org, owner
**`owner@acme.test`** (password = `SEED_PASSWORD`), super-admin
`admin@nodescope.test`, a property tree, 5 devices with connections, and a
"Main Building" 3D model.

### 5. Run the product

The browser UI is served **same-origin by the appliance stack** (the API ships
no CORS since the Decision 11 cutover, so the cross-origin `dev:web` flow is
retired). To click through the real product locally, use the appliance compose:

```bash
docker compose -f deploy/docker-compose.prod.yml -f deploy/docker-compose.build.yml \
  -f deploy/docker-compose.demo.yml --env-file deploy/.env up -d --build
```

then open `http://localhost:8080`, or start the 3D viewer against it:

```bash
npm run dev:desktop   # Electron — point it at http://localhost:8080/api
```

You can import a real IFC **from inside the desktop app** (no CLI): as an
OWNER/ADMIN, open a building and use the **"Import an IFC model"** action on the
empty state (or **Import IFC model** in the viewport toolbar) to upload +
activate an `.ifc` file and reload the viewport in place. See
**[`SETUP.md`](./SETUP.md)** for the full walkthrough.

### Tests

The API is C# (`src/`); its gate is the black-box contract suite plus the unit
suites (see `tests/NodeScope.ContractTests/README.md` for the full recipe):

```bash
docker compose -f docker-compose.test.yml up -d      # db :5433 / redis :6380 / minio :9100
scripts/run-csharp-host.sh                           # host on :5199, migrates on boot
NODESCOPE_BASE_URL=http://127.0.0.1:5199 NODESCOPE_REALTIME_TRANSPORT=signalr \
  dotnet test tests/NodeScope.ContractTests
dotnet test tests/NodeScope.ArchitectureTests tests/NodeScope.Platform.Tests \
  tests/NodeScope.Monitoring.Tests tests/NodeScope.Agent.Tests
```

---

## Production Deployment — DigitalOcean App Platform

> ⚠️ **Historical (pre-C#-migration).** This paid path and its workflows
> (`.do/app.yaml`, `.github/workflows/{ci,deploy,deploy-validate}.yml`) describe
> the Node stack and reference files the Decision 11 cutover deleted; CI has been
> `workflow_dispatch`-only since Decision 3 and the self-hosted runner is
> offline. The supported deployment is the self-hosted appliance -
> **[`deploy/README.md`](./deploy/README.md)**. Reviving cloud CI/CD is its own
> decision and these workflows get rewritten for the C# stack then.

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
