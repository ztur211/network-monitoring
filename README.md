# NodeScope

NodeScope documents and operates physical network infrastructure. It maps devices,
connections, circuits, and fiber runs across GIS and per-building 3D BIM views, with
live monitoring, agent-based probes, team permissions, and assisted troubleshooting.

The current product stack is:

- ASP.NET Core on .NET 10, organized as a modular monolith under `src/`
- PostgreSQL 16 with TimescaleDB and PostGIS, owned through EF Core migrations
- A native Avalonia desktop client in `src/NodeScope.Desktop`
- A small NativeAOT monitoring agent in `src/NodeScope.Agent`
- A single-host Docker appliance under `deploy/`

See [docs/PRD.md](docs/PRD.md) for the product requirements and
[docs/migration/csharp-migration-decisions.md](docs/migration/csharp-migration-decisions.md)
for the migration decisions.

## Quick start

Requirements:

- Docker Engine or Docker Desktop with Compose v2
- .NET 10 SDK
- A desktop session for Avalonia and browser-based PKCE sign-in

Start the local appliance, seed demo data, and launch the native client:

```bash
./scripts/run-desktop.sh
```

On Windows PowerShell:

```powershell
.\scripts\run-desktop.ps1
```

The scripts create a git-ignored `deploy/.env.desktop-dev`, build the appliance,
apply migrations, seed the Acme Networks demo, and launch Avalonia. In the client,
enter `http://localhost:8080` as the appliance URL. Do not append `/api`.

The seeded owner is:

- Email: `owner@acme.test`
- Password: `devpassword123`

Useful script options:

- `--reset` or `-Reset`: remove local appliance volumes before starting
- `--no-model` or `-NoModel`: skip the sample IFC download
- `--desktop-only` or `-DesktopOnly`: launch only the native client
- `--backend-only` or `-BackendOnly`: start and seed only the appliance
- `--stop` or `-Stop`: stop the local appliance and keep its volumes

See [SETUP.md](SETUP.md) for the manual flow and troubleshooting.

## Development

Restore and build:

```bash
dotnet restore NodeScope.slnx
dotnet build NodeScope.slnx -c Release --no-restore
```

Run the native desktop client against an existing appliance:

```bash
dotnet run --project src/NodeScope.Desktop
```

Run the API against the disposable integration services:

```bash
docker compose -f docker-compose.test.yml up -d
SEED_PASSWORD=devpassword123 scripts/run-csharp-host.sh seed
scripts/run-csharp-host.sh
```

The API listens on `http://127.0.0.1:5199` and applies pending migrations before
serving.

## Verification

Formatting, build, architecture, and unit tests:

```bash
dotnet format NodeScope.slnx --verify-no-changes --no-restore
dotnet build NodeScope.slnx -c Release --no-restore

for project in \
  tests/NodeScope.ArchitectureTests/NodeScope.ArchitectureTests.csproj \
  tests/NodeScope.Platform.Tests/NodeScope.Platform.Tests.csproj \
  tests/NodeScope.Monitoring.Tests/NodeScope.Monitoring.Tests.csproj \
  tests/NodeScope.Agent.Tests/NodeScope.Agent.Tests.csproj \
  tests/NodeScope.Desktop.Tests/NodeScope.Desktop.Tests.csproj
do
  dotnet test "$project" -c Release --no-build
done
```

The contract suite is intentionally black-box and requires a running API:

```bash
docker compose -f docker-compose.test.yml up -d
SEED_PASSWORD=devpassword123 scripts/run-csharp-host.sh seed
scripts/run-csharp-host.sh

NODESCOPE_BASE_URL=http://127.0.0.1:5199 \
NODESCOPE_REALTIME_TRANSPORT=signalr \
dotnet test tests/NodeScope.ContractTests
```

Run the host in a separate terminal before the last command. The complete contract
test recipe is in
[tests/NodeScope.ContractTests/README.md](tests/NodeScope.ContractTests/README.md).

## Deployment and releases

The supported deployment is the single-host appliance:

- [deploy/README.md](deploy/README.md) covers install, configuration, backup, and
  remote access.
- `deploy/nodescope.sh install` generates secrets, starts the stack, and smoke-tests
  the real same-origin route.
- `scripts/agent-release/build.sh` produces signed agent payloads in
  `deploy/agent-dist/`.
- GitHub release and image workflows live under `.github/workflows/`.

Do not commit `deploy/.env`, agent signing keys, tokens, or other local secrets.

## Repository layout

```text
src/
  NodeScope.Api/                  ASP.NET Core composition root
  NodeScope.Contracts/            stable client and agent contracts
  NodeScope.Desktop/              native Avalonia client
  NodeScope.Agent/                NativeAOT monitoring agent
  NodeScope.Platform*/            shared platform services and seams
  Modules/                        bounded product modules
tests/
  NodeScope.ContractTests/        black-box HTTP and SignalR contract suite
  NodeScope.*.Tests/              unit, architecture, and client tests
deploy/                           self-hosted appliance and agent installers
docs/                             product, architecture, and migration decisions
```

## License

Proprietary - all rights reserved.
