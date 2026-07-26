# NodeScope self-hosted appliance

The supported deployment is a single Linux host running Docker Compose. Caddy
serves one public origin and routes the web shell, ASP.NET Core API, SignalR hubs,
local map tiles, and signed agent downloads.

## Requirements

- Linux with Docker Engine and Docker Compose v2
- At least 4 GB RAM for the running appliance
- At least 6 GB RAM while building a map region
- Outbound internet for image pulls and the initial map extract
- `curl` and `openssl`

No .NET or Node toolchain is required when using published images.

## Install

```bash
git clone https://github.com/ztur211/nodescope.git
cd nodescope
./deploy/nodescope.sh install
```

The installer:

1. Generates missing secrets in `deploy/.env`.
2. Detects the host LAN address and records `PUBLIC_ORIGIN`.
3. Pulls the versioned API, web, and tiles images.
4. Builds the configured local map region.
5. Starts the stack and waits for health checks.
6. Smoke-tests the real same-origin routes through Caddy.

Open the printed origin, create the first account, and enter that same origin in
the native desktop client. Do not append `/api`.

Use an explicit origin for a fixed hostname or reverse proxy:

```bash
./deploy/nodescope.sh install --origin https://nodescope.example.com
```

Skip the initial map extract when bringing up the rest of the product first:

```bash
./deploy/nodescope.sh install --no-tiles
```

## Appliance commands

```text
./deploy/nodescope.sh status
./deploy/nodescope.sh logs [service]
./deploy/nodescope.sh up
./deploy/nodescope.sh down
./deploy/nodescope.sh smoke [--no-tiles]
./deploy/nodescope.sh reconfigure [--origin URL]
./deploy/nodescope.sh tiles [--rebuild]
```

`reconfigure` changes the public origin without rebuilding images. Run `smoke`
after proxy, DNS, or firewall changes.

## Architecture

```text
client
  |
  v
Caddy :80 or :443
  |-- /api/* and /hubs/* -> ASP.NET Core API :3000
  |-- /tiles/*           -> tileserver-gl :8080
  |-- /agent/*           -> signed static agent payloads
  `-- everything else    -> ASP.NET Core API :3000 (serves /login, 404s the rest)

API -> PostgreSQL 16 with TimescaleDB and PostGIS
API -> local blob volume by default
```

The API applies pending EF Core migrations before it begins serving. A database
created by the retired Node stack is detected and baselined before later
migrations run.

The default filesystem storage backend writes to the `blobstore` volume. Set
`STORAGE_DRIVER=s3` and the S3-compatible variables when an external object store
is required.

## Configuration

`deploy/nodescope.sh install` creates `deploy/.env` and never overwrites an
existing secret. To configure manually:

```bash
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
```

Important values:

| Variable | Purpose |
| --- | --- |
| `PUBLIC_ORIGIN` | Exact browser and desktop-facing origin |
| `POSTGRES_PASSWORD` | Appliance database password |
| `BETTER_AUTH_SECRET` | Session signing secret |
| `SECRET_ENCRYPTION_KEY` | Base64 encoding of exactly 32 random bytes |
| `WEB_PORT` | Host port mapped to Caddy, default 8080 |
| `TRUST_PROXY` | Number of trusted proxy hops in front of the API |
| `STORAGE_DRIVER` | `fs` by default, or `s3` |
| `MONITORING_PROBER_ENABLED` | Enables the embedded single-node prober |
| `NODESCOPE_VERSION` | Image tag to run, default `latest` |
| `TILES_AREA` | Geofabrik area slug used by Planetiler |
| `TILES_BBOX` | Optional region bounding box |

Generate secrets with:

```bash
openssl rand -base64 24
openssl rand -base64 48
openssl rand -base64 32
```

The third output is suitable for `SECRET_ENCRYPTION_KEY`.

## Map tiles

The desktop map never needs a public tile provider at runtime. Planetiler creates
`region.mbtiles` on the `tiledata` volume, and tileserver-gl renders the bundled
NodeScope style from it.

Set the desired region in `deploy/.env`, then run:

```bash
./deploy/nodescope.sh tiles
```

Rebuild after changing the area or bounding box:

```bash
./deploy/nodescope.sh tiles --rebuild
```

See [tiles/README.md](tiles/README.md) for region selection, storage sizing, and
asset provenance.

## Backups

Create a compressed PostgreSQL dump:

```bash
./deploy/backup.sh /var/backups/nodescope
```

Copy backups off the appliance host and test restores regularly. Database dumps
do not include the `blobstore` or `tiledata` volumes, so back up required blob
content separately. The map region can be regenerated.

## Remote access

Keep one canonical `PUBLIC_ORIGIN`. Common choices are:

- A private Tailscale address for trusted operators
- Tailscale Funnel for a public `*.ts.net` HTTPS origin
- Cloudflare Tunnel using the optional `cloudflared` Compose profile
- A separate reverse proxy terminating TLS in front of Caddy

When another proxy is inserted, update `TRUST_PROXY` so rate limits use the real
client address, then run:

```bash
./deploy/nodescope.sh reconfigure --origin https://nodescope.example.com
./deploy/nodescope.sh smoke
```

## Building images locally

The base Compose file pulls GHCR images. Add the build overlay for repository
development:

```bash
docker compose \
  -f deploy/docker-compose.prod.yml \
  -f deploy/docker-compose.build.yml \
  --env-file deploy/.env \
  up -d --build --wait
```

The web image includes whatever signed payload is present in
`deploy/agent-dist/`. Create it before building a release image:

```bash
scripts/agent-release/build.sh
```

The signing key defaults to `~/.nodescope/agent-signing.key` and must match the
public key pinned by the agent and both installers.

## Monitoring agent

Create a one-time enrollment code from Settings in the client.

Linux x64 or arm64:

```bash
curl -fsSL https://nodescope.example.com/agent/install.sh \
  | sudo bash -s -- \
      --server https://nodescope.example.com \
      --code <enrollment-code>
```

Windows x64 from elevated PowerShell 7:

```powershell
Invoke-WebRequest https://nodescope.example.com/agent/install.ps1 -OutFile install.ps1
.\install.ps1 -Server https://nodescope.example.com -Code <enrollment-code>
```

Both installers verify SHA-256 and an ECDSA P-256 publisher signature before
installing. The agent pins the same public key for self-updates. Windows
PowerShell 5.1 is intentionally rejected because it cannot perform the required
PEM signature verification.

## Operational checks

- `docker compose ... ps` should show every long-running service healthy.
- `./deploy/nodescope.sh smoke` should pass through the public origin.
- Container logs are size-limited by the Compose configuration.
- Services use `restart: unless-stopped`.
- Keep `deploy/.env`, signing keys, and backups out of version control.
