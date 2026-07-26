# NodeScope native 3D demo

This walkthrough runs the appliance in Docker and the native Avalonia client on
the host. It is suitable for Windows, Linux, macOS, and WSLg.

## Fast path

From the repository root:

```bash
./scripts/run-desktop.sh
```

On Windows PowerShell:

```powershell
.\scripts\run-desktop.ps1
```

The script builds the appliance, seeds the public FZK-Haus IFC, and opens the
native client.

## Manual appliance start

For published images:

```bash
docker compose \
  -f deploy/docker-compose.prod.yml \
  -f deploy/docker-compose.demo.yml \
  --env-file deploy/.env.demo \
  up -d --wait db api web

docker compose \
  -f deploy/docker-compose.prod.yml \
  -f deploy/docker-compose.demo.yml \
  --env-file deploy/.env.demo \
  run --rm demo-seed
```

Add `-f deploy/docker-compose.build.yml` before `--env-file` to build the API and
web images from the current checkout.

Verify the user-facing route:

```bash
curl -fsS http://localhost:8080/api/health
```

## Native client

From source:

```bash
dotnet run --project src/NodeScope.Desktop
```

Or extract the `nodescope-desktop-win-x64.zip` or
`nodescope-desktop-linux-x64.tar.gz` asset from a GitHub release and run
`NodeScope.Desktop`.

In the sign-in view:

1. Enter `http://localhost:8080`. Do not append `/api`.
2. Sign in with `owner@acme.test` and `devpassword123` - the form is native,
   no browser opens.
3. Open Main Building and select the seeded model.

The expected demo:

- FZK-Haus renders in the native 3D viewport.
- Selecting an element opens its IFC properties.
- Network devices can be placed and inspected in model space.
- BCF issues preserve camera, visibility, and selection state.
- Live device health and metrics update through SignalR.

## Reset or stop

```bash
./scripts/run-desktop.sh --stop
./scripts/run-desktop.sh --reset
```

The reset option removes local demo volumes and reseeds from scratch. Never reuse
the throwaway secrets in `deploy/.env.demo` for a real deployment.
