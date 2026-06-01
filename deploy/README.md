# NodeScope — Self-Hosted Demo Deployment Runbook

> **Goal:** stand up a functional, production-grade demo of NodeScope on a single
> Linux machine you control, for **free** (no paid cloud).
>
> This is a **separate path** from the paid DigitalOcean App Platform deployment
> documented in [`../README.md` → "Production Deployment"](../README.md). That
> wiring (`.do/app.yaml`, `.github/workflows/deploy.yml`) stays as the paid
> reference; **nothing here changes it.**

---

## 0. Why self-host (the binding constraint)

NodeScope's database needs **PostgreSQL 16 with _both_ TimescaleDB _and_ PostGIS**
(hypertable for `DeviceMetric`, geometry column on `Device`). Practically no free
managed Postgres offers both:

| Free option | PostGIS | TimescaleDB | Verdict |
|---|---|---|---|
| Supabase free | ✅ | ❌ (not offered) | ✗ |
| Neon free | ✅ | ❌ | ✗ |
| Railway/Render free PG | ❌ | ❌ | ✗ |
| **`timescale/timescaledb-ha:pg16` (self-hosted)** | ✅ | ✅ | **✓** |

The repo's own `docker-compose.yml` already uses `timescale/timescaledb-ha:pg16`,
which bundles both extensions. So the free path is **Docker Compose on your Linux
box** — reusing that image and adding the API + web on top.

---

## 1. Target architecture (recommended)

Single host, **one public origin**, same-origin routing (simplest cookies/CORS/CSP):

```
                         Internet
                            │
                 Cloudflare Tunnel (free TLS + hostname,
                            │       no inbound port-forward)
                            ▼
        ┌─────────────── your Linux box (Docker) ───────────────┐
        │  caddy  ──/api/*, /socket.io/*──▶  api  (NestJS :3000) │
        │    │     ──everything else──────▶  web static (SPA)    │
        │    └── serves apps/web/dist with index.html catchall   │
        │  api ──▶ db (timescaledb-ha:pg16)  +  redis:7          │
        └────────────────────────────────────────────────────────┘
```

- **One origin** (e.g. `https://nodescope.example.com`) for both the web app and
  the API. The browser talks to `/api/...` on the same origin it loaded from →
  **no cross-site cookies, no CORS preflight pain, one TLS cert.**
- This **diverges** from `.do/app.yaml`'s two-subdomain model
  (`api.` + `app.nodescope.io`). That two-domain split is correct for the paid
  load-balanced deployment; for a single-box demo, same-origin is simpler and
  every existing feature still works (`main.ts` just needs `FRONTEND_URL` set to
  the one origin, and CORS allowing the same origin is a harmless no-op).
- **Cloudflare Tunnel** is the recommended exposure: free, gives a stable HTTPS
  hostname, requires **no inbound ports** (good for a home machine), and hides
  your IP. Alternatives: Caddy doing its own Let's Encrypt on a box with ports
  80/443 open + a domain you control; or `*.trycloudflare.com` ephemeral URLs for
  a throwaway demo.

---

## 2. The one open decision — public hostname & routing

This is the "discuss later" item. Everything domain-dependent
(`FRONTEND_URL`, `BETTER_AUTH_URL`, `EXPO_PUBLIC_API_URL`, the web CSP, and the
hardcoded URLs in `scripts/smoke.mjs`) keys off it.

| Option | Hostname | TLS | Effort | Recommended for |
|---|---|---|---|---|
| **A. Cloudflare Tunnel + free CF domain** | `demo.<yourdomain>` (CF-managed) | free, automatic | low | **a stable demo** |
| B. Cloudflare Tunnel quick tunnel | random `*.trycloudflare.com` | free, automatic | lowest | a throwaway demo |
| C. Caddy + Let's Encrypt | a domain you own, ports 80/443 open | free, automatic | medium | a box with a public IP |

Recommendation: **A** (same-origin, one hostname). Pick the hostname and we wire
the configs to it (tracked as a blocked issue).

---

## 3. Prerequisites (on the host)

- A Linux machine with **Docker Engine + Docker Compose v2** and **≥ 2 GB RAM**
  (TimescaleDB + the Node API together want headroom).
- Outbound internet (Cloudflare Tunnel needs **no inbound** ports).
- An **Anthropic API key** (you have one) — and **set a spend cap** in the
  Anthropic console before exposing the demo, since the AI endpoint will be
  publicly reachable.
- The repo cloned on the box (or built elsewhere and images pushed — the runbook
  assumes building on the box).

---

## 4. Steps (sequenced: get it running, then harden)

Owner legend: **[repo]** = changes I make in this repository · **[host]** = you run
on the box · **[decide]** = a choice you make.

### D0 — Host prep · [host]
- Install Docker Engine + Compose v2; add your user to the `docker` group.
- Basic SSH hardening (key-only auth, no root login, a firewall allowing only SSH
  + outbound).

### D1 — In-repo deploy artifacts · [repo]
New files under `deploy/` (none exist yet — the repo has no API Dockerfile and the
web is only ever built as a static export):
- **`deploy/Dockerfile.api`** — multi-stage: `npm ci --legacy-peer-deps` →
  `prisma generate` → `npm run build --workspace=apps/api` → runtime image running
  `node apps/api/dist/main.js` as a non-root user, with a `/api/health` healthcheck.
- **`deploy/Dockerfile.web`** (or a Caddy build stage) — `npm run build --workspace=apps/web`
  producing `apps/web/dist`, baked with `EXPO_PUBLIC_API_URL` = the chosen origin.
- **`deploy/Caddyfile`** — serve `apps/web/dist` with `try_files … index.html`
  (SPA catchall), and `reverse_proxy /api/* /socket.io/*` → `api:3000`.
- **`deploy/docker-compose.prod.yml`** — `db` (timescaledb-ha:pg16, named volume,
  healthcheck), `redis` (with AOF persistence), `api` (waits for `db` healthy, runs
  `prisma migrate deploy` on start, then boots), `caddy`, and optionally
  `cloudflared`. `restart: unless-stopped` on all.
- **`deploy/.env.example`** — every var the API/web need (see §5),
  with `openssl`-based generation notes. The real `.env` is **git-ignored**.

### D2 — Configure secrets · [host] + [repo]
Copy `deploy/.env.example` → `deploy/.env`, then fill:
- `BETTER_AUTH_SECRET` — `openssl rand -base64 48`
- `POSTGRES_PASSWORD` — `openssl rand -base64 24` (and matching `DATABASE_URL`)
- `ANTHROPIC_API_KEY` — your key
- `SEED_PASSWORD` — for the one-shot demo seed user
- the single-origin URLs (filled once §2 is decided)

### D3 — Build, bring up, migrate · [host]
```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
# the api container runs `prisma migrate deploy` on start; confirm:
docker compose -f deploy/docker-compose.prod.yml logs api | grep -i migrat
# (TimescaleModule creates the hypertable/compression/retention idempotently on boot)
```
On a **fresh** DB the manually-authored `20260516000000_init` migration applies
(adds the PostGIS extension, geometry column + sync trigger, ChangeLog
constraint). Verify extensions: `SELECT postgis_version();` and
`SELECT extversion FROM pg_extension WHERE extname='timescaledb';`.

Optionally seed demo data: `SEED_PASSWORD=… docker compose … exec api npx prisma db seed`.

### D4 — Expose · [host] + [decide]
Per §2, point Cloudflare Tunnel (or Caddy TLS) at the host so the chosen hostname
serves the Caddy container. Once the hostname is fixed, **[repo]** parameterizes
`FRONTEND_URL` / `BETTER_AUTH_URL` / `EXPO_PUBLIC_API_URL`, the web CSP, and
`scripts/smoke.mjs` to it.

### D5 — Verify · [host]
```bash
node scripts/smoke.mjs https://<origin> https://<origin>
```
All six checks should pass (health, unauth session, CORS preflight, Socket.io
handshake, web shell, SPA catchall). Then a manual walkthrough: sign up → set home
location → add devices on 2 floors → connection + fiber run → circuit → AI
assistant → confirm live metrics tick.

### D6 — Production hardening (single-host adaptation) · [host] + [repo]
- **DB backups** — `deploy/backup.sh [out-dir]` writes a timestamped gzipped `pg_dump`; cron it to off-box storage (`0 3 * * * …/deploy/backup.sh /var/backups/nodescope`). (+ volume snapshots.)
- **Redis persistence** — AOF on (already in the compose), survives restart.
- **Restart & health** — `restart: unless-stopped` + container `healthcheck`s so
  Docker auto-recovers crashes.
- **Two API replicas** — run `api` with `--scale api=2` behind Caddy for in-host
  redundancy + rolling restarts (not true multi-AZ HA — see §6).
- **Log rotation** — configured in the compose (`json-file`, `max-size: 10m`, `max-file: 3`) so container logs can't fill the host disk.
- **`trust proxy`** — `main.ts` sets `trust proxy: 1`; behind Tunnel→Caddy the hop
  count differs, so confirm `req.ip` is the real client (affects per-IP AI rate
  limiting + `checkOnHome`). Adjust if needed.
- **Anthropic spend cap** — set in console (non-negotiable for a public demo).
- **Secrets** — `deploy/.env` is git-ignored; never commit it.

---

## 5. Environment variables (API + web)

| Var | Where | Value (single-origin demo) |
|---|---|---|
| `NODE_ENV` | api | `production` |
| `PORT` | api | `3000` |
| `DATABASE_URL` | api | `postgresql://nodescope:<pw>@db:5432/nodescope` |
| `REDIS_URL` | api | `redis://redis:6379` |
| `BETTER_AUTH_SECRET` | api | `openssl rand -base64 48` |
| `BETTER_AUTH_URL` | api | `https://<origin>` |
| `FRONTEND_URL` | api | `https://<origin>` (required — `main.ts` throws without it) |
| `ANTHROPIC_API_KEY` | api | your key (spend cap set) |
| `AI_PROVIDER` | api | `claude` |
| `GEOCODING_USER_AGENT` | api | `NodeScope/1.0 (you@example.com)` |
| `SEED_PASSWORD` | api (seed only) | demo user password |
| `EXPO_PUBLIC_API_URL` | web (build-time) | `https://<origin>` |

---

## 6. Mapping to the Phase-9 production checklist

How each paid-cloud Phase-9 item is satisfied — or deliberately deferred — for the
free self-hosted demo:

| Phase-9 checklist item | Self-hosted demo |
|---|---|
| Managed PG (TimescaleDB+PostGIS) | `timescaledb-ha:pg16` container ✓ |
| Managed Redis | `redis:7` container ✓ |
| App Platform 2× instances, zero-downtime | 2 API replicas behind Caddy (in-host) — **partial** |
| PgBouncer pooling (`DATABASE_URL`) | Not needed at demo scale; **deferred** |
| DO Spaces bucket | Post-MVP (floor plans/installers) — **deferred** |
| HTTPS enforced | Cloudflare Tunnel / Caddy TLS ✓ |
| DO monitoring alerts | Container healthchecks + (optional) Uptime Kuma — **adapted** |
| `prisma migrate deploy` pre-deploy | API entrypoint runs it ✓ |
| Anthropic spend cap | Set in console ✓ |
| Post-deploy smoke test | `scripts/smoke.mjs` against the origin ✓ |
| `npm audit` zero high/critical | Already met in shippable code (residual advisories are Expo/RN dev-tooling, not bundled) ✓ |

### Genuinely deferred (require paid infra) — deliberate decisions
- **True multi-host HA** (a single box is a single point of failure).
- **Managed connection pooling** (PgBouncer) — unnecessary at demo concurrency.
- **Object storage** (Spaces) — only used by post-MVP features.
- **Hosted monitoring/alerting** — replaced by lightweight self-hosted health/uptime.

These are fine for a demo; revisit when promoting to real production (at which point
the existing `.do/app.yaml` paid path becomes the better target).

---

## 7. Tracking

Progress is tracked in the **"Demo Launch (self-hosted)"** GitHub milestone — one
issue per step above, labelled `deployment`, each marked `[repo]` (I implement) or
`[host]` (you run). The domain-dependent work (D4) is blocked on the §2 decision.
