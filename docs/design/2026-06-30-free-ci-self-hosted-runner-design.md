# Design: free CI via a self-hosted runner

**Date:** 2026-06-30
**Status:** approved (brainstorm), pending implementation
**Related:** `docs/design/ci-self-hosted-runner.md` (host runbook, PR #68), PR #67 (`claude/ci-self-hosted-runner`, flips `ci.yml` to self-hosted)

## Goal

Run NodeScope's CI for **$0** without changing how it looks or works on GitHub.
The repo is private, so GitHub-*hosted* runner minutes draw on the account's
included allowance — which we are not paying to extend. Keep the existing
workflow YAML and the GitHub PR-check UI; just move the compute onto a
self-hosted runner on a Linux host we already own.

Non-goals: replacing GitHub Actions as the orchestrator, changing the test
tiers, or setting up Windows/macOS self-hosted runners.

## Why this is free

GitHub bills **GitHub-hosted** runner minutes. **Self-hosted runner minutes are
free and unlimited** — they do not count against the included monthly minutes or
any spending limit. Moving a workflow's jobs to `runs-on: [self-hosted, linux,
x64]` therefore takes that workflow's recurring cost to zero, permanently, while
PR status checks, logs, and the Actions UI keep working unchanged.

## Scope — which workflows move

| Workflow | Trigger | Runner OS | Decision | Reason |
|---|---|---|---|---|
| `ci.yml` | every push/PR to main/master | 5× Linux | **→ self-hosted** | the cost driver; all-Linux; runs constantly |
| `deploy-validate.yml` | PR (path-filtered) + dispatch | 1× Linux | **→ self-hosted** | Linux; uses `docker compose`; host has Docker |
| `deploy.yml` | manual dispatch | 4× Linux | **→ self-hosted** | Linux; manual/rare but moved per request |
| `release.yml` | release tags + dispatch | Linux **+ macOS + Windows** | **stay hosted** | one Linux runner cannot run mac/win legs; rare |
| `desktop-build.yml` | manual dispatch | **Windows** | **stay hosted** | needs Windows; rare |

The Linux + frequently-triggered workflows move; the cross-platform / Windows
ones are rare and physically cannot run on a single Linux box, so they stay
GitHub-hosted. **Caveat:** if the included monthly minutes are exhausted, those
two hosted workflows will not run until the allowance resets — acceptable
because they only fire on release tags / manual dispatch.

## Host requirements

The runner host (the Arch Linux box per the existing runbook) needs:

- **Rootful Docker** + the **compose v2 plugin** + **buildx**. `ci.yml` uses
  Docker `services:` containers (Postgres/Redis) and a `docker run` for MinIO;
  `deploy-validate.yml` runs `docker compose build/up/down`. Rootless Docker can
  break Actions service-container networking — use rootful. The runner user must
  be in the `docker` group.
- **Runner runtime libs** (Arch): `icu krb5 zlib openssl lttng-ust` (the .NET
  agent's deps; Arch isn't covered by the runner's bundled `installdependencies.sh`).
- **Node is NOT pre-installed** — `actions/setup-node@v6` downloads Node 20 per job.
- **Outbound network** to Docker Hub / ghcr / npm. For `deploy.yml` specifically:
  reachability to **production** — the prod database (`PROD_DATABASE_URL`, for
  `prisma migrate deploy`) and DigitalOcean (`doctl`, `DIGITALOCEAN_ACCESS_TOKEN`).
- **Disk** for images + node_modules + builds (grows over time; see prune timer).

Existing GitHub Actions **secrets** (`PROD_DATABASE_URL`, `DIGITALOCEAN_ACCESS_TOKEN`,
`DO_APP_ID`, `GITHUB_TOKEN`) work identically on a self-hosted runner — no change.

## Deliverables

### 1. Workflow changes
- `ci.yml`: all 5 jobs → `runs-on: [self-hosted, linux, x64]`; add idempotent
  `docker rm -f minio 2>/dev/null || true` before the MinIO `docker run` (a
  persistent runner can have a leftover container from a prior run). This is
  exactly PR #67 — reuse it.
- `deploy-validate.yml`: its 1 job → self-hosted.
- `deploy.yml`: its 4 jobs → self-hosted.
- `release.yml`, `desktop-build.yml`: **unchanged**, but add a one-line comment
  at each `runs-on` noting they intentionally stay GitHub-hosted (mac/win).

### 2. `scripts/setup-self-hosted-runner.sh`
Idempotent Arch provisioning, safe to re-run:
- Install Docker (`pacman -S --needed docker`), `systemctl enable --now docker`,
  add the invoking user to the `docker` group (warn that re-login is needed),
  plus the compose/buildx plugin and the runner runtime libs.
- Download the **latest** runner release into `~/actions-runner` (resolve the
  version from the GitHub releases API; skip if already present).
- Register **unattended** if not already configured (detect the `.runner` file):
  `./config.sh --url https://github.com/ztur211/nodescope --token "$TOKEN"
  --labels self-hosted,linux,x64 --unattended`. The one-time **token is supplied
  by the user** (arg `--token` or `$RUNNER_TOKEN`) — it is generated in GitHub's
  UI and cannot be obtained programmatically here.
- Install + start the boot service (`sudo ./svc.sh install "$USER"` then `start`),
  then print the post-step: confirm **Idle** in Settings → Actions → Runners.
- Refuse to run as root; `set -euo pipefail`; clear status echoes at each step.

### 3. Disk housekeeping — `docker system prune` timer
Two unit files the script installs (and documents):
- `docker-prune.service` → `ExecStart=/usr/bin/docker system prune -af --filter "until=168h"`
- `docker-prune.timer` → weekly (`OnCalendar=weekly`, `Persistent=true`), enabled.

### 4. Doc refresh
Update `docs/design/ci-self-hosted-runner.md` to: point at the setup script as
the happy path (manual steps kept as the fallback), list the expanded scope
(ci + deploy-validate + deploy), the compose/buildx host need, and the sequencing
rule below.

## Critical sequencing

Flipping `runs-on` to `self-hosted` **before** a runner is registered makes every
job queue forever ("Waiting for a runner…") instead of failing fast. Therefore
split the work into two independently-mergeable commits:

- **Commit A — safe, merge anytime:** the setup script, the prune units, and the
  doc refresh. These change *nothing* about how current CI runs.
- **Commit B — gated:** the `runs-on` flips in `ci.yml` / `deploy-validate.yml` /
  `deploy.yml`. **Do not merge until the runner shows Idle.**

Rollout order:
1. Merge Commit A.
2. **User** runs the setup script on the host, pastes the registration token,
   confirms the runner is **Idle** in the GitHub UI.
3. Merge Commit B. The next push to master is the first real self-hosted CI run
   and the end-to-end validation.

## Division of labor

- **I produce (from here):** both commits — the script, units, doc, and the
  workflow flips — on a branch; YAML + shell validated (see Verification).
- **You do (on your host, unavoidable):** generate the runner token in
  `Settings → Actions → Runners → New self-hosted runner`, run the setup script
  on the machine, and confirm Idle. This ephemeral WSL2 sandbox is neither your
  host nor able to mint a runner token (the `gh` token is dead and runner tokens
  are host-bound regardless).

## Verification

- **Static:** parse/lint the changed workflow YAML (actionlint if available, else
  a YAML parse); `shellcheck` + `bash -n` the setup script; `systemd-analyze
  verify` the unit files if systemd is present in-sandbox.
- **Behavioral (already proven this session):** every test tier the runner will
  execute passes locally — api unit 590 / int 183 / e2e 372, web/desktop/agent/
  client/probe, lint, build. The runner just relocates that same work.
- **End-to-end:** the first push after Commit B merges; a green run on the
  self-hosted runner with no queued/hung jobs confirms success.

## Risks & caveats

- **The runner executes repo CI code on your host.** Repo is private (no fork-PR
  arbitrary-code risk), but prefer an isolated machine/VM over a daily driver.
- **`deploy.yml` runs production actions from your box** (prod migrations + DO
  deploy). It's manual-dispatch only, so it's deliberate, but note the host now
  needs prod credentials/reachability.
- **Runner must be powered on** to pick up jobs; otherwise runs queue until it is.
- **First run is slow** (pulls `timescaledb-ha`, `redis`, `minio` images + npm
  deps); cached thereafter. The prune timer keeps disk in check.
- **Reverting:** set the jobs back to `runs-on: ubuntu-latest` and stop the
  service (`sudo ./svc.sh stop && uninstall`); workflows are otherwise identical.

## Out of scope

- Replacing GitHub Actions with a different CI system (Woodpecker/Forgejo/Drone).
- Self-hosted Windows/macOS runners for `release.yml` / `desktop-build.yml`.
- Branch protection / required-check changes (master stays unprotected as today).
