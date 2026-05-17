# NodeScope

Browser-based network mapping & management platform. Users document their physical network — devices, connections, circuits — on a GIS map, and the app provides real-time metrics, AI-assisted troubleshooting, and multi-floor support.

MVP scope is browser-only, personal-use, single-network. See `docs/PRD.md` for full requirements.

---

## Local Setup

### 1. Install dependencies

```bash
npm install
```

`.npmrc` at the repo root sets `legacy-peer-deps=true`. This is required because React Native 0.85's strict `react@^19.2.3` peer conflicts with Better Auth's flexible peer ranges, and because some companion packages (`expo-router`, `react-native-worklets`) are listed as root devDependencies purely to force them to hoist to the root `node_modules` — Expo's `babel-preset-expo` calls `require.resolve('expo-router')` from its own hoisted location and won't find workspace-local installs.

### 2. Copy environment file

```bash
cp .env.example .env
```

Edit `.env` and set:
- `ANTHROPIC_API_KEY` — your Anthropic key (only required to test AI assistant)
- `BETTER_AUTH_SECRET` — minimum 32 characters; the placeholder works for local dev
- `SEED_PASSWORD` — password for the seeded dev user

`.env` is read by the backend. The web app reads its config from environment variables at build/start time — `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_MAP_TILE_STYLE_URL`. Local defaults (in `.env.example`) point at `http://localhost:3000` and OpenFreeMap respectively, which is what `npm run dev --workspace=apps/web` expects.

### 3. Start local services

```bash
docker compose up -d
```

This starts PostgreSQL 16 + TimescaleDB + PostGIS (timescaledb-ha image) and Redis on the default ports (5432, 6379).

### 4. Apply database migrations

```bash
npx prisma migrate dev --schema=apps/api/prisma/schema.prisma
```

The initial migration enables the `postgis` extension, creates all MVP tables, adds the PostGIS geometry column + `device_location_sync` trigger to `Device`, and applies the `ChangeLog` `entityType` check constraint. TimescaleDB hypertable conversion and retention policies are applied at API startup via `TimescaleModule` — no manual step.

### 5. Seed the dev user

```bash
npx prisma db seed --schema=apps/api/prisma/schema.prisma
```

Creates `dev@nodescope.io` with the password from `SEED_PASSWORD`, plus 5 sample devices, 2 connections, 1 fiber run, and 1 circuit.

### 6. Run the API and web app

```bash
npm run dev --workspace=apps/api
npm run dev --workspace=apps/web
```

- API: http://localhost:3000
- Web: http://localhost:8081

### Tests

```bash
npm run test:unit --workspace=apps/api
docker compose -f docker-compose.test.yml up -d
npm run test:integration --workspace=apps/api
npm run test:e2e --workspace=apps/api
```

---

## Production Deployment — DigitalOcean App Platform

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
5. **Attach the secrets** (DATABASE_URL, REDIS_URL, BETTER_AUTH_SECRET, ANTHROPIC_API_KEY) via the DO console or `doctl apps update <APP_ID> --spec -`. The spec declares them with empty values so the file round-trips without leaking them, but they must be set once per app.
6. **DNS** — CNAME `api.nodescope.io` and `app.nodescope.io` to the App Platform default ingress hostname (visible in the DO console after the first deploy).
7. **Anthropic spend cap** — set a hard spend cap in the Anthropic console **before** the first production deploy. This is the sixth layer of AI rate limiting and the only one that lives outside this codebase.

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
| `entry-*.js` | 1.44 MB | **412 KB** | Initial paint |
| `MapView-*.js` | 793 KB | 209 KB | First visit to the map screen |

The 500 KB gzipped initial-paint target from `CLAUDE.md` is met by the entry chunk. If a future change pushes the entry chunk over budget, the source-map attribution recipe is in `progress.md` Phase 9b under "Web bundler config + code splitting".

---

## Repository Layout

See `CLAUDE.md` for the full module-by-module breakdown and project rules.

```
nodescope/
  apps/
    api/         NestJS backend (TypeScript, strict)
    web/         React Native + Expo Web (TypeScript, strict)
  packages/
    shared/      Types shared between api and web
  docs/          PRD, SAD, API Design, DB Schema, Implementation Plan
```

## License

Proprietary — all rights reserved.
