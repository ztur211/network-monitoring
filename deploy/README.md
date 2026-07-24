# NodeScope — Self-Hosted Demo Deployment Runbook

> **Goal:** stand up a functional, production-grade demo of NodeScope on a single
> Linux machine you control, for **free** (no paid cloud).
>
> This is a **separate path** from the paid DigitalOcean App Platform deployment
> documented in [`../README.md` → "Production Deployment"](../README.md). That
> wiring (`.do/app.yaml`, `.github/workflows/deploy.yml`) stays as the paid
> reference; **nothing here changes it.**

## Quick start — LAN appliance (one command)

On any Linux host with Docker + the compose plugin:

```bash
git clone https://github.com/ztur211/nodescope.git
cd nodescope
./deploy/nodescope.sh install
```

`install` generates the secrets, auto-detects this box's LAN IP, pulls the
prebuilt images from GHCR, brings the stack up, and smoke-tests it. When it
finishes it prints the URL — open `http://<box-ip>:8080` on any machine on the
LAN, create the first account, and point the desktop app at
`http://<box-ip>:8080/api`.

- **The IP changed?** `./deploy/nodescope.sh reconfigure` — no rebuild.
- **Fixed origin / HTTPS?** `./deploy/nodescope.sh install --origin https://nodescope.example.com`.
- **Everyday ops:** `./deploy/nodescope.sh status | logs | up | down`.

The sections below cover manual setup, remote access (Tailscale / Cloudflare
Tunnel), and the optional cloud deploy — none of which a LAN appliance needs.

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
        ┌─────────────── your Linux box (Docker) ────────────────┐
        │  caddy ──/api/*, /hubs/*──▶  api  (ASP.NET Core :3000)  │
        │    │    ──everything else─▶  web static (SPA)           │
        │    └── serves the static export with index.html fallback│
        │  api ──▶ db (timescaledb-ha:pg16)                       │
        └─────────────────────────────────────────────────────────┘
```

- **One origin** (e.g. `https://nodescope.example.com`) for both the web app and
  the API. The browser talks to `/api/...` on the same origin it loaded from →
  **no cross-site cookies, no CORS preflight pain, one TLS cert.**
- This **diverges** from `.do/app.yaml`'s two-subdomain model
  (`api.` + `app.nodescope.io`). That two-domain split is correct for the paid
  load-balanced deployment; for a single-box demo, same-origin is simpler and
  every existing feature still works (`main.ts` just needs `FRONTEND_URL` set to
  the one origin, and CORS allowing the same origin is a harmless no-op).
- **Tailscale Funnel** is the recommended exposure: free on all plans, gives a
  stable HTTPS `*.ts.net` hostname with a valid cert, needs **no domain** and
  **no inbound ports**, and has no interstitial warning page. Alternatives:
  Cloudflare Tunnel + a domain (clean custom hostname, ~$10/yr); Caddy's own
  Let's Encrypt (a domain + ports 80/443); or a `*.trycloudflare.com` quick
  tunnel (ephemeral — throwaway only).

---

## 2. The one open decision — public hostname & routing

This is the "discuss later" item. Everything domain-dependent
(`FRONTEND_URL`, `BETTER_AUTH_URL`, the desktop app's server URL) keys off it.

| Option | Hostname | Free? | Effort | Notes |
|---|---|---|---|---|
| **A. Tailscale Funnel (recommended)** | `https://<box>.<tailnet>.ts.net` | ✅ free, no domain | low–med | stable, valid HTTPS, no interstitial, no inbound ports; `ts.net`-branded host + fair-use bandwidth cap |
| B. Cloudflare Tunnel + a domain | `demo.<yourdomain>` | tunnel free, domain ~$10/yr | low | clean custom hostname; needs a domain on Cloudflare |
| C. Cloudflare quick tunnel | random `*.trycloudflare.com` | ✅ free | lowest | **ephemeral** — URL changes each restart; throwaway only |
| D. Caddy + Let's Encrypt | a domain you own, ports 80/443 | domain ~$10/yr | medium | needs a public IP + open ports |

**Decision: A — Tailscale Funnel.** Set `PUBLIC_ORIGIN` to your `ts.net` URL and
`TRUST_PROXY=2` (Funnel + Caddy hops); everything else derives from
`PUBLIC_ORIGIN`. Steps in D4.

---

## 3. Prerequisites (on the host)

- A Linux machine with **Docker Engine + Docker Compose v2** and **≥ 2 GB RAM**
  (TimescaleDB + the API together want headroom).
- Outbound internet (Tailscale Funnel / Cloudflare Tunnel need **no inbound** ports).
- The repo cloned on the box (or built elsewhere and images pushed — the runbook
  assumes building on the box). No other toolchain: the install and smoke test are
  plain bash + curl.

---

## 4. Steps (sequenced: get it running, then harden)

Owner legend: **[repo]** = changes I make in this repository · **[host]** = you run
on the box · **[decide]** = a choice you make.

### D0 — Host prep · [host]
- Install Docker Engine + Compose v2; add your user to the `docker` group.
- Basic SSH hardening (key-only auth, no root login, a firewall allowing only SSH
  + outbound).

### D1 — In-repo deploy artifacts · [repo]
What lives under `deploy/`:
- **`deploy/Dockerfile.api`** — multi-stage: `dotnet publish src/NodeScope.Api`
  (Release, warnings-as-errors) → `mcr.microsoft.com/dotnet/aspnet` runtime image
  running as the non-root `app` user, with a `/api/health` healthcheck. The host
  applies EF migrations itself on boot (baselining a Prisma-era database), so
  there is no entrypoint script. The same image runs the demo seed one-shot
  (`seed` argument).
- **`deploy/Dockerfile.web`** — builds the web static export; origin-agnostic
  (same-origin at runtime), so no rebuild on IP change. Also bakes the staged
  agent binaries + manifest under `/srv/agent` (Decision 13).
- **`deploy/Caddyfile`** — serves the SPA with `try_files … index.html`
  (catchall), and `reverse_proxy /api/* /hubs/*` → `api:3000`.
- **`deploy/docker-compose.prod.yml`** — `db` (timescaledb-ha:pg16, named volume,
  healthcheck), `api` (waits for `db` healthy; migrates then serves), `caddy`,
  and optionally `cloudflared`. `restart: unless-stopped` on all.
- **`deploy/.env.example`** — every var the API/web need (see §5),
  with `openssl`-based generation notes. The real `.env` is **git-ignored**.

### D2 — Configure secrets · [host] + [repo]
Copy `deploy/.env.example` → `deploy/.env`, then fill:
- `BETTER_AUTH_SECRET` — `openssl rand -base64 48`
- `SECRET_ENCRYPTION_KEY` — `openssl rand -base64 32` (SNMP credential crypto; boot-required)
- `POSTGRES_PASSWORD` — `openssl rand -base64 24` (and matching `DATABASE_URL`)
- `SEED_PASSWORD` — for the one-shot demo seed user
- the single-origin URLs (filled once §2 is decided)

### D3 — Build, bring up, migrate · [host]
```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
# the api host applies EF migrations before it serves; confirm:
docker compose -f deploy/docker-compose.prod.yml logs api | grep -i -e migrat -e baseline
# (the MonitoringMetric_5m continuous aggregate is ensured idempotently on boot)
```
On a **fresh** DB the `Initial` migration builds the whole schema (PostGIS
extension, geometry column + sync trigger, TimescaleDB hypertables, compression
and retention policies). A database created by the Node-era stack is detected and
**baselined** — the migration is stamped as applied, the schema untouched. Verify
extensions: `SELECT postgis_version();` and
`SELECT extversion FROM pg_extension WHERE extname='timescaledb';`.

Optionally seed demo data with the demo overlay's one-shot (see
`deploy/docker-compose.demo.yml`), or directly:
`docker compose … run --rm api seed` (needs `SEED_PASSWORD` in the env).

### D4 — Expose · [host]
**Tailscale Funnel (recommended).** On the host:
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# One-time: in the Tailscale admin console, enable Funnel + HTTPS for the tailnet.
sudo tailscale funnel --bg 8080     # publish Caddy's host port (WEB_PORT) publicly
tailscale funnel status             # prints your stable https://<box>.<tailnet>.ts.net
```
Then in `deploy/.env` set `PUBLIC_ORIGIN=https://<box>.<tailnet>.ts.net`,
`TRUST_PROXY=2` (Funnel → Caddy → API), keep `SITE_ADDRESS=:80` (Funnel
terminates TLS), and re-run `up -d --build` so the web bundle bakes the origin.

Alternatives — **Cloudflare Tunnel**: add `--profile tunnel` + `CLOUDFLARE_TUNNEL_TOKEN`
and route your CF hostname to `http://web:80`; **Caddy TLS**: set `SITE_ADDRESS`
to your domain, publish 443, and drop `auto_https off` from the Caddyfile.
`PUBLIC_ORIGIN` drives `FRONTEND_URL` / `BETTER_AUTH_URL` — no code changes needed.

### D5 — Verify · [host]
`deploy/nodescope.sh install` runs the smoke test itself (curl-only: API health,
unauthenticated get-session, web shell, SPA catchall); re-run it any time with a
plain `curl` against those URLs. Then a manual walkthrough: sign up → set home
location → add devices on 2 floors → connection + fiber run → circuit → confirm
device status updates.

### D6 — Production hardening (single-host adaptation) · [host] + [repo]
- **DB backups** — `deploy/backup.sh [out-dir]` writes a timestamped gzipped `pg_dump`; cron it to off-box storage (`0 3 * * * …/deploy/backup.sh /var/backups/nodescope`). (+ volume snapshots.)
- **Restart & health** — `restart: unless-stopped` + container `healthcheck`s so
  Docker auto-recovers crashes.
- **Log rotation** — configured in the compose (`json-file`, `max-size: 10m`, `max-file: 3`) so container logs can't fill the host disk.
- **`TRUST_PROXY`** — defaults to 1 (the Caddy hop); behind Tunnel→Caddy set 2 so
  rate limiting keys on the real client, not a shared edge address.
- **Secrets** — `deploy/.env` is git-ignored; never commit it.

---

## 5. Environment variables (API + web)

| Var | Where | Value (single-origin demo) |
|---|---|---|
| `NODE_ENV` | api | `production` — still read by the C# host: it gates the production rate limits on the same check the Node stack used |
| `DATABASE_URL` | api | `postgresql://nodescope:<pw>@db:5432/nodescope` |
| `SECRET_ENCRYPTION_KEY` | api | `openssl rand -base64 32` (required — API refuses to boot without it) |
| `STORAGE_DRIVER` | api | `fs` (default; blobs on the blobstore volume) or `s3` |
| `STORAGE_FS_ROOT` | api | `/data/storage` (set by compose; fs mode only) |
| `BETTER_AUTH_SECRET` | api | `openssl rand -base64 48` |
| `BETTER_AUTH_URL` | api | `https://<origin>` |
| `FRONTEND_URL` | api | `https://<origin>` (required) |
| `TRUST_PROXY` | api | proxy hops to trust for the client IP; `1` default, `2` behind a tunnel |
| `GEOCODING_USER_AGENT` | api | `NodeScope/1.0 (you@example.com)` |
| `SEED_PASSWORD` | seed one-shot | demo user password |

---

## 6. Mapping to the Phase-9 production checklist

How each paid-cloud Phase-9 item is satisfied — or deliberately deferred — for the
free self-hosted demo:

| Phase-9 checklist item | Self-hosted demo |
|---|---|
| Managed PG (TimescaleDB+PostGIS) | `timescaledb-ha:pg16` container ✓ |
| App Platform 2× instances, zero-downtime | Single API instance; in-process state (Decision 8) — **deferred to the MSP topology** |
| PgBouncer pooling (`DATABASE_URL`) | Not needed at demo scale; **deferred** |
| DO Spaces bucket | Filesystem storage backend (`STORAGE_DRIVER=fs`) ✓ |
| HTTPS enforced | Cloudflare Tunnel / Caddy TLS ✓ |
| DO monitoring alerts | Container healthchecks + (optional) Uptime Kuma — **adapted** |
| Migrations before serving | The host applies EF migrations on boot, before it listens ✓ |
| Post-deploy smoke test | `deploy/nodescope.sh install` runs its curl smoke test ✓ |

### Genuinely deferred (require paid infra) — deliberate decisions
- **True multi-host HA** (a single box is a single point of failure).
- **Managed connection pooling** (PgBouncer) — unnecessary at demo concurrency.
- **Hosted object storage** (Spaces/S3) — replaced by the filesystem storage backend
  (`STORAGE_DRIVER=fs`, blobs on a local volume); S3 remains a config switch away.
- **Hosted monitoring/alerting** — replaced by lightweight self-hosted health/uptime.

These are fine for a demo; revisit when promoting to real production (at which point
the existing `.do/app.yaml` paid path becomes the better target).

---

## 8. NodeScope Monitoring Agent

The NodeScope Agent is a lightweight background daemon (built in Spec 8) that monitors
devices assigned to it and pushes reachability checks and latency metrics to the server
without requiring an open browser tab.

### Installing on a managed host

The appliance serves its own agents (migration Decision 13): binaries, installers, and
an update manifest are baked into the web image at `/srv/agent` and served by Caddy at
`/agent/*`. Stage them with `scripts/agent-release/build.sh` before building the image.

Obtain the one-time enrollment code from the web app under **Settings → Agents →
Generate Code** (the dialog shows this exact command), then on the target host:

**Linux (systemd)**
```bash
curl -fsSL http://<server>/agent/install.sh | sudo bash -s -- --server http://<server> --code <code>
```

**Windows (elevated PowerShell — startup task)**
```powershell
iwr http://<server>/agent/install.ps1 -OutFile install.ps1
.\install.ps1 -Server http://<server> -Code <code>
```

Both installers:
1. Download the platform binary from the appliance, then verify its sha256 **and** its
   ECDSA publisher signature against the pinned NodeScope key before installing.
2. Run `nodescope-agent enroll --code <code> --url <server>/api` to exchange the code
   for a per-agent token (sent via the `x-agent-token` header on each request).
   Re-running without `--code` upgrades the binary and keeps the enrollment.
3. Register and start the OS service. The Linux unit uses `Restart=always` (and the
   Windows runner loops) because self-update exits 0 after swapping the binary.

Once enrolled, the agent appears in the **Agents** management list, begins pushing
device status within one probe interval (default 30 s), and thereafter updates itself:
it polls `/agent/manifest.json` on its own server hourly, verifies any newer binary
against the pinned publisher key, swaps in place, and restarts. Opt out per host with
`NODESCOPE_AGENT_AUTO_UPDATE=off`; the previous binary is kept next to the new one as
`nodescope-agent.old` for manual rollback.

The legacy Node-agent installers in `apps/agent/scripts/` and the DigitalOcean Spaces
publishing path are superseded by the above and leave with the Node code.

See `apps/agent/README.md` for full CLI reference and configuration options.

---

## 7. Tracking

Progress is tracked in the **"Demo Launch (self-hosted)"** GitHub milestone — one
issue per step above, labelled `deployment`, each marked `[repo]` (I implement) or
`[host]` (you run). The domain-dependent work (D4) is blocked on the §2 decision.
