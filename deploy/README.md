# NodeScope self-hosted appliance

The supported deployment is a single Linux host running Docker Compose. Caddy
serves one public origin and routes the ASP.NET Core API, SignalR hubs,
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
3. Pulls the versioned API, gateway, and tiles images.
4. Builds the configured local map region.
5. Starts the stack and waits for health checks.
6. Smoke-tests the real same-origin routes through Caddy.

Open the native desktop client, enter the printed origin without an `/api`
suffix, and create the first account. Expand "Setting up a new appliance?" and
paste the bootstrap code printed by the installer to create the first
organization and become its OWNER.

Use an explicit origin for a fixed hostname or reverse proxy:

```bash
./deploy/nodescope.sh install --origin https://nodescope.example.com
```

Skip the initial map extract when bringing up the rest of the product first:

```bash
./deploy/nodescope.sh install --no-tiles
```

## Claiming the first organization

The bootstrap credential is not an alternate sign-in password. It authorizes one
specific transition from an empty database to the first organization.

1. Run `./deploy/nodescope.sh install` and keep its final output private.
2. Open NodeScope Desktop and create the first user account.
3. Expand "Setting up a new appliance?" on the organization access screen.
4. Enter the organization name and the printed bootstrap code.
5. Select "Create first organization."

The API creates the organization and OWNER membership atomically. It rejects
every later bootstrap attempt once any organization exists, even if the
credential is correct.

If the terminal output is no longer available, a trusted host administrator can
read `BOOTSTRAP_TOKEN` from the mode-0600 `deploy/.env` file. Do not send that
file or its contents through chat, issue trackers, or screenshots.

An upgraded appliance may gain a generated `BOOTSTRAP_TOKEN` in its environment.
That does not reopen bootstrap when the database already contains an
organization.

## Adding people

In NodeScope Desktop, an OWNER or ADMIN opens Settings > Organization and enters
the teammate's email address.

- OWNER can create MEMBER, ADMIN, or OWNER invitations.
- ADMIN can create MEMBER invitations.
- The resulting `nodescope-invite-v1:<token>` code is shown only once.
- The code expires after seven days and only the invited email can redeem it.
- Creating a replacement invitation for the same email invalidates the previous
  pending code.

Send the code directly to the intended person. They create an account or sign in
with the invited email and paste the code at the native organization access
screen.

Domain-based access requests are available only for domains already claimed by
platform administration. The desktop does not currently expose domain claiming,
so invitation codes are the normal self-hosted workflow. See
[NodeScope Organizations](../docs/product-knowledge/organizations.md) for role
rules, approval behavior, and error meanings.

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
  `-- everything else    -> ASP.NET Core API :3000 (404s: there is no browser surface)

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
existing secret. Keep that file with the appliance volumes and include a
protected copy in the backup plan. Losing or replacing its database password or
encryption key can make persisted data inaccessible. To configure manually:

```bash
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
```

Important values:

| Variable | Purpose |
| --- | --- |
| `PUBLIC_ORIGIN` | Exact desktop-facing origin |
| `POSTGRES_PASSWORD` | Appliance database password |
| `SECRET_ENCRYPTION_KEY` | Base64 encoding of exactly 32 random bytes |
| `BOOTSTRAP_TOKEN` | Credential accepted only while zero organizations exist |
| `WEB_PORT` | Host port mapped to Caddy, default 8080 |
| `TRUST_PROXY` | Number of trusted proxy hops in front of the API |
| `STORAGE_DRIVER` | `fs` by default, or `s3` |
| `MONITORING_PROBER_ENABLED` | Enables the embedded single-node prober |
| `NODESCOPE_VERSION` | Image tag to run, default `latest` |
| `TILES_AREA` | Geofabrik area slug used by Planetiler |
| `TILES_BBOX` | Optional region bounding box |

Generate secrets with:

```bash
openssl rand -hex 32
openssl rand -base64 32
openssl rand -base64 24
```

Use the first output for `POSTGRES_PASSWORD`, the second for
`SECRET_ENCRYPTION_KEY`, and the third for `BOOTSTRAP_TOKEN`.

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

The gateway image includes whatever signed payload is present in
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
- The appliance root should return 404 because there is no browser surface.
- Container logs are size-limited by the Compose configuration.
- Services use `restart: unless-stopped`.
- Keep `deploy/.env`, signing keys, and backups out of version control.
