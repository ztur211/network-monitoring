# NodeScope

Reference `/home/zachp/dotfiles/AGENTS.md` when coding.

## What this is

NodeScope is a local-first network infrastructure platform. The current product is a
.NET 10 modular monolith with an ASP.NET Core API, an Avalonia desktop client, and a
NativeAOT monitoring agent. The appliance still serves the transition Expo web client.

## Build, test, and run

- Restore: `dotnet restore NodeScope.slnx` and `npm ci`
- Build: `dotnet build NodeScope.slnx -c Release --no-restore` and `npm run build`
- Format: `dotnet format NodeScope.slnx --verify-no-changes --no-restore`
- Lint: `npm run lint`
- .NET unit tests: run every test project except `NodeScope.ContractTests`
- Web and transition desktop tests: `npm test`
- Contract tests: follow `tests/NodeScope.ContractTests/README.md`; they require the
  test containers and a running API host
- Full local product: `./scripts/run-desktop.sh`
- API only: start `docker-compose.test.yml`, then run `scripts/run-csharp-host.sh`

## Conventions

- Keep module dependencies flowing through application and domain boundaries. The
  architecture tests enforce the allowed graph.
- Use ASP.NET Core minimal APIs. Business logic belongs in modules, not `Program.cs`.
- The API owns the schema through EF Core migrations and applies them before serving.
- Keep contract tests black-box. Do not reference API or module implementation projects.
- Keep the agent NativeAOT-compatible and independent of server implementation code.
- Keep desktop client code behind appliance API and platform seams. Do not reference
  server implementation projects.
- Treat warnings as failures. The .NET build and web lint configuration enforce this.
- Preserve same-origin appliance behavior under `/api`, `/hubs`, `/tiles`, and `/agent`.

## Boundaries

- Do not edit generated changelogs or generated migration snapshots by hand.
- Do not commit `deploy/.env`, signing keys, tokens, or local development secrets.
- Do not weaken architecture, analyzer, contract, or signature verification gates to
  make a build pass.
- Treat `docker-compose.override.yml` as developer-local unless explicitly requested.
