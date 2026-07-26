# NodeScope local setup

This guide runs the self-hosted appliance and the native Avalonia desktop client
on Windows, Linux, macOS, or WSLg.

## Prerequisites

- Docker Engine or Docker Desktop with Compose v2
- .NET 10 SDK
- Git
- A desktop session

On Windows, Docker Desktop should use its WSL2 backend.

## Quick start

Linux, macOS, or WSLg:

```bash
./scripts/run-desktop.sh
```

Windows PowerShell:

```powershell
.\scripts\run-desktop.ps1
```

The script:

1. Generates git-ignored development secrets in `deploy/.env.desktop-dev`.
2. Builds and starts PostgreSQL, the ASP.NET Core API, and the same-origin Caddy
   gateway at `http://localhost:8080`.
3. Applies EF Core migrations before the API starts serving.
4. Seeds the Acme Networks organization, sample inventory, and sample IFC.
5. Launches `src/NodeScope.Desktop`.

Enter `http://localhost:8080` in the desktop client. The client adds `/api`,
`/hubs`, and `/tiles` itself, so do not enter an `/api` suffix.

Sign in with:

| Role | Email | Password |
| --- | --- | --- |
| Organization owner | `owner@acme.test` | `devpassword123` |
| Platform super-admin | `admin@nodescope.test` | No interactive credential |

The desktop client signs in natively: enter the email and password in the app
itself (or switch to "Create one" for a new account). No browser is involved.
The demo seed already owns the appliance, so a newly created account needs an
invitation from the seeded owner.

### Script options

| Linux/macOS/WSL | PowerShell | Effect |
| --- | --- | --- |
| `--reset` | `-Reset` | Remove appliance volumes before startup |
| `--no-model` | `-NoModel` | Skip the sample IFC download |
| `--desktop-only` | `-DesktopOnly` | Launch the client without changing Docker |
| `--backend-only` | `-BackendOnly` | Start and seed the appliance without a GUI |
| `--stop` | `-Stop` | Stop the appliance and keep its volumes |

## Manual demo setup

Copy the appliance environment template:

```bash
cp deploy/.env.example deploy/.env
```

Set at least:

```dotenv
PUBLIC_ORIGIN=http://localhost:8080
POSTGRES_PASSWORD=<openssl rand -base64 24>
SECRET_ENCRYPTION_KEY=<openssl rand -base64 32>
BOOTSTRAP_TOKEN=<openssl rand -base64 24>
SEED_PASSWORD=devpassword123
```

Generate each value with the matching `openssl` command and paste its output
after `=`. The environment file does not evaluate shell expressions.

Start the locally built appliance:

```bash
docker compose \
  -f deploy/docker-compose.prod.yml \
  -f deploy/docker-compose.build.yml \
  -f deploy/docker-compose.demo.yml \
  --env-file deploy/.env \
  up -d --build --wait db api web
```

Run the idempotent demo seed:

```bash
docker compose \
  -f deploy/docker-compose.prod.yml \
  -f deploy/docker-compose.build.yml \
  -f deploy/docker-compose.demo.yml \
  --env-file deploy/.env \
  run --rm demo-seed
```

Confirm the same route an end user uses:

```bash
curl -fsS http://localhost:8080/api/health
```

Launch the native client:

```bash
dotnet run --project src/NodeScope.Desktop
```

The appliance has no browser surface; every user-facing interaction happens in
the desktop client.

## Clean appliance first run

To test the same first-owner path used by a new production appliance, omit the
demo overlay and seed:

```bash
docker compose \
  -f deploy/docker-compose.prod.yml \
  -f deploy/docker-compose.build.yml \
  --env-file deploy/.env \
  up -d --build --wait db api web
```

Then launch the desktop client:

```bash
dotnet run --project src/NodeScope.Desktop
```

Create the first account. It remains authenticated at the organization access
screen. Expand "Setting up a new appliance?", enter an organization name, and
paste the `BOOTSTRAP_TOKEN` value from `deploy/.env`. A successful claim makes
that account the first OWNER and opens the workspace.

Bootstrap succeeds only while the database contains zero organizations. Once
the demo seed or a prior bootstrap has created one, use an invitation code
instead. See
[NodeScope Organizations](docs/product-knowledge/organizations.md) for the full
membership lifecycle.

## Local map tiles

The production appliance builds a local region extract during
`deploy/nodescope.sh install`. The lightweight desktop-development script does not
download that extract. To exercise the native map with no WAN dependency, configure
`TILES_AREA` and `TILES_BBOX` in `deploy/.env`, then run:

```bash
NODESCOPE_ENV_FILE="$PWD/deploy/.env" ./deploy/nodescope.sh tiles
```

Start or restart the `tiles` service afterward. See
[deploy/tiles/README.md](deploy/tiles/README.md) for region sizing and rebuilds.

## API and contract-test development

Start the disposable integration services:

```bash
docker compose -f docker-compose.test.yml up -d
```

Apply migrations and seed once:

```bash
SEED_PASSWORD=devpassword123 scripts/run-csharp-host.sh seed
```

Start the API:

```bash
scripts/run-csharp-host.sh
```

In another terminal:

```bash
NODESCOPE_BASE_URL=http://127.0.0.1:5199 \
  dotnet test tests/NodeScope.ContractTests
```

The disposable services use PostgreSQL on port 5433, Redis on 6380, and MinIO on
9100. The current C# API does not use Redis in the single-node topology, but the
compose file keeps it available for parity and future multi-node work.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| API rejects `SECRET_ENCRYPTION_KEY` | Generate exactly 32 random bytes and store their base64 form. |
| Bootstrap reports `ORG_016` | Set `BOOTSTRAP_TOKEN` for the API and restart it. |
| Bootstrap reports `ORG_017` | Paste the exact token, without an environment variable name or surrounding quotes. |
| Bootstrap reports `ORG_018` | The appliance is already claimed; sign in as an owner and create an invitation code. |
| A new account stays at organization access | This is expected until it accepts an invitation, receives domain approval, or bootstraps a clean appliance. |
| `demo-seed` requires a password | Set `SEED_PASSWORD` in the env file passed to Compose. |
| The 3D viewport is empty | Re-run the demo seed with outbound internet available, or import an IFC from the client. |
| The map reports missing tiles | Build the local region extract as described above. |
| Port 8080 is occupied | Change `WEB_PORT` and `PUBLIC_ORIGIN` together, then enter the new origin in the client. |
| A clean database is needed | Run the quick-start script with its reset option. |

For the supported host deployment, backups, agent install, and remote access, see
[deploy/README.md](deploy/README.md).
