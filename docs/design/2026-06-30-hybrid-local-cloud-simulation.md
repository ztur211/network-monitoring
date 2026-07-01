# Runbook: hybrid local/cloud simulation (local-first proof)

**Date:** 2026-06-30
**Status:** verified working (in an ephemeral sandbox) — this is the reproducible runbook
**Related:** [`2026-06-30-local-first-architecture-direction.md`](./2026-06-30-local-first-architecture-direction.md)

## What this proves

NodeScope is a network monitor, so it must keep working during the very outage it monitors.
This simulation stands up an **on-prem site server** (full stack, *TimescaleDB kept*) that
monitors a device fleet locally, exposes it to the internet through a **cloud edge** (a
Cloudflare tunnel), and then **cuts the WAN** to show:

- the site keeps monitoring its LAN and writing to its **local** Timescale DB,
- **local** clients keep working,
- only **remote/cloud** access is lost, and it fully recovers (with zero data loss) when the
  link returns.

```
  LOCAL (on-prem site LAN)                         CLOUD edge            CLOUD vantage
  ┌────────────────────────────────────┐                                ┌───────────────────┐
  │ Site server: NestJS API :3000       │   cloudflared quick tunnel     │ free VM / phone /  │
  │ Postgres16 + TimescaleDB + PostGIS  │ ◀════════════════════════════▶ │ off-network device │
  │ Redis · MinIO                       │  https://<rand>.trycloudflare  │ = remote client    │
  │ Embedded prober → devices, every 15s│  .com                          │                    │
  └────────────────────────────────────┘                                └───────────────────┘
       source of truth lives HERE              the only WAN-crossing            sees the site
                                               component (optional)             only via the URL
```

## Prerequisites

- Node 20–22, the repo cloned, `npm install` done.
- Docker (for the infra) **or** native Postgres16+TimescaleDB+PostGIS / Redis / MinIO.
- `cloudflared` (installed in Part C).

## Part A — stand up the on-prem site server

### A1. Infra (Docker path — recommended on your machine)
`docker-compose.yml` publishes the standard ports that `.env.example` already expects
(Postgres `5432`, Redis `6379`, MinIO `9000`):

```bash
docker compose up -d        # db (timescaledb-ha:pg16) + redis + minio
```

> Native alternative (what the sandbox used, no Docker): run Postgres16+Timescale+PostGIS,
> Redis, MinIO as native services. The sandbox put Redis on `6380` and MinIO on `9100` and
> pointed `.env` at those; adjust `REDIS_URL` / `STORAGE_ENDPOINT` to match if you go native.

### A2. Site env (`/.env`)
Copy `.env.example` to `.env` and change two things — generate a real encryption key and
**turn the embedded prober ON** (this is the on-prem monitoring path; the cloud path would
use the Agent instead):

```bash
cp .env.example .env
# generate the SNMP-credential key (32 bytes base64):
KEY=$(openssl rand -base64 32)
sed -i "s|^SECRET_ENCRYPTION_KEY=.*|SECRET_ENCRYPTION_KEY=$KEY|" .env
sed -i "s|^MONITORING_PROBER_ENABLED=.*|MONITORING_PROBER_ENABLED=true|" .env
# faster polling for the demo (optional):
sed -i "s|^MONITORING_PROBE_INTERVAL_MS=.*|MONITORING_PROBE_INTERVAL_MS=15000|" .env
```

Key values the site server uses (defaults from `.env.example`):
`DATABASE_URL=…@localhost:5432/nodescope_dev`, `REDIS_URL=redis://localhost:6379`,
`STORAGE_ENDPOINT=http://localhost:9000`, `PORT=3000`.

### A3. Migrate + seed the site DB
```bash
npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma
npm run db:seed     # idempotent: org + super-admin (admin@nodescope.test) + 5 sample devices
```

### A4. Boot the site server
```bash
npm run dev:api     # loads ../../.env via ConfigModule; boots NestJS on :3000
```
Look for `Nest application successfully started`, `Embedded prober enabled`, and
`MonitoringMetric_5m continuous aggregate ready` in the log.

### A5. Verify it's up and monitoring
```bash
# Health (NOTE: health is /api/health, NOT under /api/v1):
wget -qO- http://localhost:3000/api/health
# → {"status":"ok","services":{"database":"ok","redis":"ok","ai":"ok"}}

# Prober writing to the LOCAL Timescale DB (grows every interval):
psql "postgresql://nodescope:localdevpassword@localhost:5432/nodescope_dev" \
  -c 'SELECT count(*) FROM "MonitoringMetric";'
```
> WSL2 quirk: `ss -ltn` may not show the `:3000` listener even though it works — verify with
> `wget`, not `ss`.

## Part B — add a reachable "UP" device (optional, nicer demo)

The 5 seeded devices are `192.168.1.x` (typically DOWN from a sandbox). Add one reachable host
(8.8.8.8:443 is open) so the fleet shows a mix of UP/latency and DOWN. Device names are unique
per `(org, lower(name))`:

```sql
-- clone an existing device row, overriding id/name/ip
INSERT INTO "Device" (<all columns>)
SELECT gen_random_uuid(), 'Internet Uplink' /*name*/, '8.8.8.8' /*ipAddress*/, <rest…>
FROM "Device" WHERE name='Core Router';
```
Next prober cycle: `Internet Uplink → UP` with a real latency.

## Part C — cloud edge (Cloudflare quick tunnel)

```bash
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  -O /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared

cloudflared tunnel --url http://localhost:3000 --no-autoupdate
# prints a public URL like https://<random>.trycloudflare.com  (free, no account, EPHEMERAL)
```
Verify the cloud edge reaches the site:
```bash
wget -qO- https://<random>.trycloudflare.com/api/health   # same JSON as localhost
```

## Part D — the cloud vantage (your free VM / any off-network device)

From a free VM (Oracle Always Free / GCP trial) — or just your phone on cellular — hit the
tunnel URL. This is the cloud → site path over the **real** internet:
```bash
URL=https://<random>.trycloudflare.com
curl -s $URL/api/health
watch -n5 "curl -s $URL/api/health"   # leave running while you cut the WAN (Part E)
```
> Only the API is tunneled here, and monitoring-data endpoints require login, so this proves
> the network path + service health. Tunnelling the web UI + scripting a login is the next
> increment for a full remote dashboard demo.

## Part E — the resilience demo (cut & restore the WAN)

```bash
# CUT: kill the tunnel. Use -x (exact process name) so pkill doesn't match its own shell:
pkill -x cloudflared

# OBSERVE (WAN down):
wget -qO- --timeout=8 https://<random>.trycloudflare.com/api/health   # REMOTE → fails
wget -qO- http://localhost:3000/api/health                            # LOCAL  → still ok
psql "$DBURL" -c 'SELECT count(*) FROM "MonitoringMetric";'           # keeps GROWING (prober alive)

# RESTORE: start a new tunnel (new URL — quick tunnels are ephemeral):
cloudflared tunnel --url http://localhost:3000 --no-autoupdate
# remote now works again and sees ALL data collected during the outage.
```

## Observed results — run of 2026-06-30

- Health identical via localhost and via the tunnel: `{"status":"ok","database":"ok","redis":"ok"}`.
- Fleet after one cycle: `Internet Uplink (8.8.8.8) UP @37ms`, `Core Router UP @6.6ms`, 4× LAN `DOWN`.
- WAN cut: `MonitoringMetric` 138 → 150 → 178 **straight through the outage**; remote `wget` failed; localhost stayed healthy; on restore the cloud saw all 178 rows. **Zero data loss; only remote visibility paused.**

## Caveats & making it persistent

- **Process lifetime:** the API + tunnel are launched detached (`nohup`/`&`), so on a
  persistent host (e.g. a WSL+tmux dev box, or a mini-PC) they **survive a client/SSH
  disconnect** — they keep running until the process is killed or the host/WSL is shut down or
  rebooted. (They do *not* survive a reboot; re-run Parts A–C after one.)
- **Tunnel URL is still ephemeral:** the `trycloudflare` quick-tunnel URL changes every time
  `cloudflared` restarts. For a stable hostname use a *named* Cloudflare tunnel (free, needs a
  CF account + a domain), and a service manager (systemd / pm2) to keep the API + tunnel up
  across reboots.
- **For a production-grade sim, move the SITE SERVER to dedicated durable hardware** (a
  mini-PC appliance) — i.e. the on-prem appliance from the architecture-direction doc. The
  cloud vantage (the free VM) stays where it is.
- A stable public hostname needs a *named* Cloudflare tunnel (free, but needs a CF account +
  a domain) instead of the ephemeral quick tunnel.

## Gotchas (things that bit during setup)

- Health endpoint is `/api/health` (outside the `/api/v1` prefix).
- `ss` doesn't show the `:3000` listener under WSL2 — verify via `wget`.
- `pkill -f "cloudflared tunnel"` matches its own shell's command line and self-kills — use
  `pkill -x cloudflared`.
- `npm run db:seed` is idempotent (skips if org/devices already exist).
- Device names are unique per `(organizationId, lower(name))`.

## Teardown

```bash
pkill -x cloudflared          # stop the tunnel
pkill -f "nest start"         # stop the API
docker compose down           # stop infra (add -v to also drop data volumes)
```

## What this means for the architecture

This validates the [local-first direction](./2026-06-30-local-first-architecture-direction.md):
the on-prem site server is the source of truth and survives WAN outages, while the cloud is a
thin optional edge. Keeping TimescaleDB on the site server worked fine here. The next
architectural step that would make the cloud tier *do* something (rather than just relay) is
the **MSP aggregator** — a second site pushing health/aggregates up to a central pane-of-glass.
