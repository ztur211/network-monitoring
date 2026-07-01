# Task: set up a GitHub Actions self-hosted runner on THIS Arch Linux machine

> A self-contained brief to hand to a Claude Code (or similar) session running **on the runner
> host**. It needs no external context. Companion to `ci-self-hosted-runner.md` (full runbook)
> and `2026-06-30-free-ci-self-hosted-runner-design.md` (design).

You are running on the Arch Linux box that will host the runner. Set up a GitHub Actions
**self-hosted runner** for the private repo **ztur211/nodescope**, end to end, and verify it.
Goal: this repo's CI runs free on this host instead of on paid GitHub-hosted minutes.

## Ground rules
- This host IS the runner — run the commands here.
- Do NOT run as root (the runner refuses root). Use a normal user with `sudo`.
- Docker must be **Docker Engine** (Arch's `docker` package = `dockerd`), NOT Docker Desktop.
  Never install `docker-desktop` — it runs Engine in a VM and breaks CI service-containers.
- Do NOT edit/flip any workflow files, and do NOT commit or push anything. Routing CI onto the
  runner is a separate human-gated merge (PR #67) done ONLY after the runner shows Idle.
- Pause and ask the human for the registration token (you cannot mint it) — see below.

## Preferred path: run the already-validated script
An idempotent setup script exists in the repo. Fetch and run it:
```bash
sudo pacman -S --needed git
git clone --depth 1 -b chore/self-hosted-runner-setup \
  git@github.com:ztur211/nodescope.git ~/ns-runner    # HTTPS alt: https://github.com/ztur211/nodescope.git
~/ns-runner/scripts/setup-self-hosted-runner.sh --token <TOKEN_FROM_HUMAN>
```
If the repo/branch isn't reachable (no GitHub auth on this box), ask the human, or build an
equivalent from the spec below.

## Registration token — HUMAN-ONLY, stop and ask
Ask the human to open `github.com/ztur211/nodescope` -> Settings -> Actions -> Runners ->
**New self-hosted runner -> Linux / x64**, and paste you the token (the `AXXXX...` on the
`./config.sh --token` line). It expires in ~1h, so ask right before you register.

## Spec (only if building it yourself)
Install on this host: Docker Engine (rootful) + git + the runner's .NET libs:
```bash
sudo pacman -Sy --needed docker docker-compose docker-buildx git icu krb5 zlib openssl lttng-ust
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"        # runner service picks this up on start
```
Then, as your normal user:
```bash
mkdir -p ~/actions-runner && cd ~/actions-runner
VER=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
curl -fL -o r.tgz https://github.com/actions/runner/releases/download/v${VER}/actions-runner-linux-x64-${VER}.tar.gz
tar xzf r.tgz && rm r.tgz
./config.sh --url https://github.com/ztur211/nodescope --token <TOKEN> \
  --labels self-hosted,linux,x64 --unattended --replace
sudo ./svc.sh install "$USER" && sudo ./svc.sh start
```
(Node is NOT needed — `actions/setup-node` downloads it per job.)

## Known Arch gotcha: ICU / .NET
If `./config.sh` errors with a `System.Globalization` / missing `libicu*.so` error:
```bash
sudo pacman -S --needed icu
# if it still fails, make .NET skip ICU entirely:
echo 'DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1' >> ~/actions-runner/.env
```
then re-run config / the script (idempotent).

## Definition of done — verify, then report
- `sudo systemctl is-active docker` -> `active`
- `cd ~/actions-runner && sudo ./svc.sh status` -> runner service active (running)
- Runner shows **Idle** at `github.com/ztur211/nodescope/settings/actions/runners`
  (confirm via `gh` if you're authenticated, else ask the human to check).

Report: what you installed, the runner name, and its Idle status. Do NOT flip any workflow.

## Notes
- The setup is idempotent — safe to re-run.
- The `docker` group needs a re-login for interactive `docker`; the runner *service* already has it.
- You'll hit `sudo` / `pacman` / `systemctl` commands — run in a permission mode that allows them.
