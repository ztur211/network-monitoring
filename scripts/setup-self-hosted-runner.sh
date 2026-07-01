#!/usr/bin/env bash
#
# setup-self-hosted-runner.sh — provision a GitHub Actions self-hosted runner
# for ztur211/nodescope, so CI runs for $0 on hardware we own instead of on
# paid GitHub-hosted minutes.
#
# Idempotent and safe to re-run. Auto-detects Arch (pacman) and Debian/Ubuntu
# (apt). See docs/design/ci-self-hosted-runner.md and
# docs/design/2026-06-30-free-ci-self-hosted-runner-design.md.
#
# Usage:
#   ./setup-self-hosted-runner.sh --token <RUNNER_REGISTRATION_TOKEN>
#   RUNNER_TOKEN=<...> ./setup-self-hosted-runner.sh
#
# The registration token is generated in the GitHub UI (it is short-lived, ~1h,
# and cannot be minted from a script):
#   github.com/ztur211/nodescope → Settings → Actions → Runners
#     → New self-hosted runner → Linux / x64   (copy the token from the ./config.sh line)
#
# Do NOT run as root — run as the unprivileged user that will own the runner;
# the script uses sudo only where a step needs it.

set -euo pipefail

# ---- config ---------------------------------------------------------------
REPO_URL="https://github.com/ztur211/nodescope"
RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner}"
RUNNER_LABELS="self-hosted,linux,x64"
ME="$(id -un)"
RUNNER_NAME="${RUNNER_NAME:-$(hostname -s 2>/dev/null || uname -n)-nodescope}"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# ---- args -----------------------------------------------------------------
TOKEN="${RUNNER_TOKEN:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --token)   TOKEN="${2:-}"; shift 2 ;;
    --token=*) TOKEN="${1#*=}"; shift ;;
    --dir)     RUNNER_DIR="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,/^set -euo/{/^set -euo/!p}' "$0" | sed 's/^#\{0,1\} \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done

# ---- preflight ------------------------------------------------------------
[[ ${EUID:-$(id -u)} -eq 0 ]] && die "do not run as root — the GitHub runner itself refuses root. Run as a regular user with sudo. Fresh Arch box? As root: 'pacman -S sudo git && useradd -mG wheel ci && passwd ci', enable %wheel via 'visudo', then re-run this as that user."
command -v sudo >/dev/null || die "sudo not found (Arch 'base' omits it). As root: 'pacman -S sudo', add your user to the 'wheel' group, enable %wheel via 'visudo'; then re-run this as that user."
command -v curl >/dev/null || die "curl is required (normally present on Arch, since pacman itself pulls in the curl package)."
[[ -r /etc/os-release ]] || die "cannot read /etc/os-release."
# shellcheck disable=SC1091
. /etc/os-release
case " ${ID:-} ${ID_LIKE:-} " in
  *" arch "*|*arch*)          PKG=pacman ;;
  *debian*|*ubuntu*)          PKG=apt ;;
  *) die "unsupported distro '${ID:-?}'. Follow docs/design/ci-self-hosted-runner.md manually." ;;
esac
log "Host: ${PRETTY_NAME:-${ID:-linux}} — package manager: $PKG, runner user: $ME"

# ---- 0. git ---------------------------------------------------------------
# actions/checkout needs git on the host; a base Arch install has none.
if ! command -v git >/dev/null 2>&1; then
  log "Installing git (required by actions/checkout)…"
  case "$PKG" in
    pacman) sudo pacman -Sy --needed --noconfirm git ;;
    apt)    sudo apt-get update -qq && sudo apt-get install -y git ;;
  esac
fi

# ---- 1. Docker Engine (rootful; NOT Docker Desktop) -----------------------
if command -v docker >/dev/null 2>&1; then
  log "Docker already present; ensuring the daemon is enabled."
  sudo systemctl enable --now docker
else
  log "Installing Docker Engine (rootful; NOT Docker Desktop)…"
  case "$PKG" in
    pacman)
      # Arch's 'docker' package IS upstream Docker Engine (dockerd + CLI), the
      # native daemon CI service-containers need — not the docker-desktop VM.
      sudo pacman -Sy --needed --noconfirm docker docker-compose docker-buildx ;;
    apt)
      # Docker's official convenience script: docker-ce + compose plugin + buildx.
      curl -fsSL https://get.docker.com | sudo sh ;;
  esac
  sudo systemctl enable --now docker
fi

# The runner user needs the Docker socket. A freshly-started systemd service
# picks up the new group, so the runner works even before an interactive re-login.
if ! id -nG "$ME" | tr ' ' '\n' | grep -qx docker; then
  log "Adding $ME to the 'docker' group…"
  sudo usermod -aG docker "$ME"
  NEED_RELOGIN=1
fi

# ---- 2. runner runtime libs (Arch only) -----------------------------------
# Debian/Ubuntu are covered by the runner's bundled installdependencies.sh
# (run after extraction). Arch is not, so install the .NET agent's libs here.
if [[ "$PKG" == pacman ]]; then
  log "Installing runner runtime libs (Arch)…"
  sudo pacman -S --needed --noconfirm icu krb5 zlib openssl lttng-ust
fi

# ---- 3. download the runner -----------------------------------------------
mkdir -p "$RUNNER_DIR"; cd "$RUNNER_DIR"
if [[ -x ./config.sh ]]; then
  log "Runner already extracted in $RUNNER_DIR."
else
  log "Resolving the latest runner release…"
  VER="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest \
         | grep -oE '"tag_name": *"v[0-9.]+"' | head -1 \
         | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)"
  [[ -n "$VER" ]] || die "could not resolve the latest runner version (GitHub API rate limit?)."
  TARBALL="actions-runner-linux-x64-${VER}.tar.gz"
  log "Downloading runner v${VER}…"
  curl -fL -o "$TARBALL" \
    "https://github.com/actions/runner/releases/download/v${VER}/${TARBALL}"
  tar xzf "$TARBALL" && rm -f "$TARBALL"
fi

if [[ "$PKG" == apt && -x ./bin/installdependencies.sh ]]; then
  log "Installing runner .NET deps (Debian/Ubuntu)…"
  sudo ./bin/installdependencies.sh
fi

# ---- 4. register ----------------------------------------------------------
if [[ -f .runner ]]; then
  log "Runner already configured (.runner present) — skipping registration."
else
  [[ -n "$TOKEN" ]] || die "no registration token. Pass --token <TOKEN> from Settings → Actions → Runners → New self-hosted runner."
  log "Registering runner '$RUNNER_NAME' with $REPO_URL…"
  ./config.sh --url "$REPO_URL" --token "$TOKEN" \
    --labels "$RUNNER_LABELS" --name "$RUNNER_NAME" --unattended --replace
fi

# ---- 5. install + start as a service (survives reboot) --------------------
if [[ -f .service ]] && sudo ./svc.sh status >/dev/null 2>&1; then
  log "Runner service already installed; (re)starting…"
  sudo ./svc.sh start || true
else
  log "Installing the runner as a systemd service…"
  sudo ./svc.sh install "$ME"
  sudo ./svc.sh start
fi
sudo ./svc.sh status || true

# ---- 6. weekly docker-prune timer (disk housekeeping) ---------------------
DOCKER_BIN="$(command -v docker)"
log "Installing weekly docker-prune systemd timer…"
sudo tee /etc/systemd/system/docker-prune.service >/dev/null <<UNIT
[Unit]
Description=Prune unused Docker data (self-hosted CI housekeeping)

[Service]
Type=oneshot
ExecStart=${DOCKER_BIN} system prune -af --filter "until=168h"
UNIT
sudo tee /etc/systemd/system/docker-prune.timer >/dev/null <<'UNIT'
[Unit]
Description=Weekly docker system prune

[Timer]
OnCalendar=weekly
Persistent=true

[Install]
WantedBy=timers.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now docker-prune.timer

# ---- done -----------------------------------------------------------------
log "Done."
echo
echo "Next steps:"
echo "  1. Confirm the runner shows 'Idle' at:"
echo "       ${REPO_URL}/settings/actions/runners"
if [[ "${NEED_RELOGIN:-0}" == 1 ]]; then
  warn "You were added to the 'docker' group. The runner *service* already has it,"
  warn "but your interactive shell needs a re-login to use 'docker' without sudo."
fi
echo "  2. Once it's Idle, merge the workflow flip (PR #67 / branch"
echo "     claude/ci-self-hosted-runner) — that routes CI onto this runner."
