# CI on a self-hosted runner

NodeScope's repo is **private**, so GitHub-hosted Actions draw on the account's included
minutes. Rather than pay for those, CI runs on a **self-hosted runner** we operate. This doc
records how to stand one up (steps written for **Arch Linux**, the current host OS).

> Sequencing matters: register the runner **first**, confirm it's `Idle`, **then** switch the
> workflow to `runs-on: [self-hosted, linux, x64]`. With the self-hosted label and no runner
> registered, jobs queue indefinitely ("Waiting for a runner…") instead of failing fast.

## What the runner host needs

- **Docker (rootful).** The `integration` and `e2e` jobs use `postgres`/`redis` **service
  containers** and a manual MinIO `docker run`; the runner user must reach the Docker socket.
  Rootless Docker can break Actions' service-container networking — use rootful.
- **A few native libs** for the .NET-based runner agent (Arch doesn't match the runner's bundled
  `installdependencies.sh`, which only knows apt/yum).
- **Outbound network** to Docker Hub / ghcr and npm, plus disk for images + builds.
- Node is **not** required pre-installed — `actions/setup-node@v6` downloads Node 20 per job.

## 1. Docker

```bash
sudo pacman -S --needed docker
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"   # log out/in so the group applies
docker run --rm hello-world       # verify
```

## 2. Runner runtime deps (Arch)

```bash
sudo pacman -S --needed icu krb5 zlib openssl lttng-ust
```

If `config.sh` (next step) complains about a missing `.so`, `pacman -S` that lib — `icu` is the
usual culprit. Alternatively the AUR `github-actions-runner` package wraps the agent + deps +
a systemd unit (`yay -S github-actions-runner`).

## 3. Register the runner

GitHub → **`ztur211/nodescope` → Settings → Actions → Runners → New self-hosted runner →
Linux / x64**. Use the exact download URL, version, and one-time token shown there:

```bash
mkdir ~/actions-runner && cd ~/actions-runner
curl -o runner.tar.gz -L https://github.com/actions/runner/releases/download/<ver>/actions-runner-linux-x64-<ver>.tar.gz
tar xzf runner.tar.gz
./config.sh --url https://github.com/ztur211/nodescope --token <TOKEN>
```

Accept the **default labels** (`self-hosted`, `Linux`, `X64`). They match the workflow's
`[self-hosted, linux, x64]` — `runs-on` label matching is case-insensitive. Do **not** run as root.

## 4. Run it as a service (survives reboot)

```bash
sudo ./svc.sh install "$USER"
sudo ./svc.sh start
sudo ./svc.sh status
```

Confirm the runner shows **Idle** under Settings → Actions → Runners.

## 5. Switch the workflow to the runner

Only once the runner is `Idle`, set all jobs in `.github/workflows/ci.yml` to:

```yaml
runs-on: [self-hosted, linux, x64]
```

(That's the change in PR #67; merge it at this point.) The MinIO step in the workflow is already
idempotent (`docker rm -f minio` before `docker run`) so re-runs on the persistent runner don't
collide on the container name.

## Housekeeping

- **First run is slow** — it pulls `timescaledb-ha`, `redis`, `minio`, and npm deps; cached after.
- **Disk** grows over time. A weekly prune keeps it in check, e.g. a systemd timer running
  `docker system prune -f` (and `docker image prune -af` occasionally).
- **Security**: the runner executes repo CI code on the host. The repo is private (no fork-PR
  arbitrary-code risk), but still prefer an isolated machine/VM over a daily-driver workstation.

## Reverting to GitHub-hosted

If you ever raise the Actions allowance, set the jobs back to `runs-on: ubuntu-latest` and stop
the service (`sudo ./svc.sh stop && sudo ./svc.sh uninstall`); the workflow is otherwise identical.
