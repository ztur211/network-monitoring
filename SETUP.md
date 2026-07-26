# NodeScope local setup

This guide runs the self-hosted appliance and the native Avalonia desktop client
on Windows, Linux, macOS, or WSLg.

## Prerequisites

- Docker Engine or Docker Desktop with Compose v2
- .NET 10 SDK
- Git
- A desktop session and system browser
- Node.js 22 and npm 10 or newer only for transition web and Electron work

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
2. Builds and starts PostgreSQL, the ASP.NET Core API, and the same-origin web
   entry point at `http://localhost:8080`.
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

The desktop flow opens the system browser and returns through the
`nodescope://auth/callback` protocol. The Avalonia client registers that protocol
for the current user when it starts.

### Script options

| Linux/macOS/WSL | PowerShell | Effect |
| --- | --- | --- |
| `--reset` | `-Reset` | Remove appliance volumes before startup |
| `--no-model` | `-NoModel` | Skip the sample IFC download |
| `--desktop-only` | `-DesktopOnly` | Launch the client without changing Docker |
| `--backend-only` | `-BackendOnly` | Start and seed the appliance without a GUI |
| `--stop` | `-Stop` | Stop the appliance and keep its volumes |

## Manual appliance setup

Copy the appliance environment template:

```bash
cp deploy/.env.example deploy/.env
```

Set at least:

```dotenv
PUBLIC_ORIGIN=http://localhost:8080
POSTGRES_PASSWORD=<openssl rand -base64 24>
BETTER_AUTH_SECRET=<openssl rand -base64 48>
SECRET_ENCRYPTION_KEY=<openssl rand -base64 32>
SEED_PASSWORD=devpassword123
```

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

The transition browser client is available at `http://localhost:8080`.

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
NODESCOPE_REALTIME_TRANSPORT=signalr \
dotnet test tests/NodeScope.ContractTests
```

The disposable services use PostgreSQL on port 5433, Redis on 6380, and MinIO on
9100. The current C# API does not use Redis in the single-node topology, but the
compose file keeps it available for parity and future multi-node work.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| API rejects `SECRET_ENCRYPTION_KEY` | Generate exactly 32 random bytes and store their base64 form. |
| `demo-seed` requires a password | Set `SEED_PASSWORD` in the env file passed to Compose. |
| The browser does not return to the desktop app | Start Avalonia before signing in and confirm the OS registered `nodescope://` for the current user. |
| The 3D viewport is empty | Re-run the demo seed with outbound internet available, or import an IFC from the client. |
| The map reports missing tiles | Build the local region extract as described above. |
| Port 8080 is occupied | Change `WEB_PORT` and `PUBLIC_ORIGIN` together, then enter the new origin in the client. |
| A clean database is needed | Run the quick-start script with its reset option. |

For the supported host deployment, backups, agent install, and remote access, see
[deploy/README.md](deploy/README.md).
