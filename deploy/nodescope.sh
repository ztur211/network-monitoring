#!/usr/bin/env bash
#
# NodeScope appliance manager — one-command install + lifecycle for the
# self-hosted site server (deploy/docker-compose.prod.yml).
#
#   ./deploy/nodescope.sh install       # generate secrets, detect LAN IP, bring the stack up, smoke-test
#   ./deploy/nodescope.sh reconfigure   # re-detect / change the LAN origin, then restart (no rebuild)
#   ./deploy/nodescope.sh status        # docker compose ps
#   ./deploy/nodescope.sh logs [svc]    # tail logs
#   ./deploy/nodescope.sh up | down     # start / stop the stack
#
# Backup, restore and update land in Phase 2.
set -euo pipefail

# shellcheck disable=SC1007 # CDPATH= is an intentional prefix-assignment, not a typo
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1007 # CDPATH= is an intentional prefix-assignment, not a typo
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
# Overridable so tests can point at a temp env file.
ENV_FILE="${NODESCOPE_ENV_FILE:-${SCRIPT_DIR}/.env}"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.prod.yml"
WEB_PORT_DEFAULT=8080

compose() { docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"; }
log() { printf '[nodescope] %s\n' "$*"; }
die() { printf '[nodescope] ERROR: %s\n' "$*" >&2; exit 1; }

# --- env-file helpers -------------------------------------------------------

get_kv() { # get_kv KEY -> prints value (empty if unset/absent)
  [ -f "${ENV_FILE}" ] || return 0
  sed -n "s/^$1=//p" "${ENV_FILE}" | head -n1
}

set_kv() { # set_kv KEY VALUE -> add or replace KEY=VALUE in ENV_FILE
  local key="$1" val="$2"
  touch "${ENV_FILE}"
  if grep -q "^${key}=" "${ENV_FILE}"; then
    grep -v "^${key}=" "${ENV_FILE}" > "${ENV_FILE}.tmp"
    printf '%s=%s\n' "${key}" "${val}" >> "${ENV_FILE}.tmp"
    mv "${ENV_FILE}.tmp" "${ENV_FILE}"
  else
    printf '%s=%s\n' "${key}" "${val}" >> "${ENV_FILE}"
  fi
}

gen_secret() { openssl rand -base64 "$1" | tr -d '\n'; }

# Fill any missing secret / default WITHOUT overwriting existing values, so
# re-running install is safe (idempotent).
ensure_env() {
  touch "${ENV_FILE}"
  [ -n "$(get_kv POSTGRES_USER)" ]         || set_kv POSTGRES_USER nodescope
  [ -n "$(get_kv POSTGRES_DB)" ]           || set_kv POSTGRES_DB nodescope
  [ -n "$(get_kv POSTGRES_PASSWORD)" ]     || set_kv POSTGRES_PASSWORD "$(gen_secret 24)"
  [ -n "$(get_kv BETTER_AUTH_SECRET)" ]    || set_kv BETTER_AUTH_SECRET "$(gen_secret 48)"
  [ -n "$(get_kv SECRET_ENCRYPTION_KEY)" ] || set_kv SECRET_ENCRYPTION_KEY "$(gen_secret 32)"
  [ -n "$(get_kv STORAGE_DRIVER)" ]        || set_kv STORAGE_DRIVER fs
  [ -n "$(get_kv NODESCOPE_VERSION)" ]     || set_kv NODESCOPE_VERSION latest
  [ -n "$(get_kv WEB_PORT)" ]              || set_kv WEB_PORT "${WEB_PORT_DEFAULT}"
  [ -n "$(get_kv AI_PROVIDER)" ]           || set_kv AI_PROVIDER claude
  grep -q '^ANTHROPIC_API_KEY=' "${ENV_FILE}" || set_kv ANTHROPIC_API_KEY ""
  chmod 600 "${ENV_FILE}"
}

detect_lan_ip() {
  # The src address the kernel would use to reach the internet = the box's
  # primary LAN IP. Falls back to the first non-loopback IPv4.
  local ip
  ip="$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n1)"
  [ -n "${ip}" ] || ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  printf '%s' "${ip}"
}

set_origin() { # set_origin [explicit-url]
  local origin="${1:-}" web_port ip
  if [ -z "${origin}" ]; then
    web_port="$(get_kv WEB_PORT)"; [ -n "${web_port}" ] || web_port="${WEB_PORT_DEFAULT}"
    ip="$(detect_lan_ip)"
    [ -n "${ip}" ] || die "could not auto-detect a LAN IP; pass --origin http://<ip>:<port>"
    origin="http://${ip}:${web_port}"
  fi
  set_kv PUBLIC_ORIGIN "${origin}"
  log "PUBLIC_ORIGIN = ${origin}"
}

# --- commands ---------------------------------------------------------------

preflight() {
  command -v docker >/dev/null 2>&1 || die "docker is not installed"
  docker compose version >/dev/null 2>&1 || die "the docker compose plugin is not installed"
  command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets"
}

cmd_install() {
  local origin=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --origin) [ $# -ge 2 ] || die "--origin requires a value"; origin="$2"; shift 2 ;;
      --web-port) [ $# -ge 2 ] || die "--web-port requires a value"; set_kv WEB_PORT "$2"; shift 2 ;;
      *) die "unknown install option: $1" ;;
    esac
  done
  preflight
  ensure_env
  set_origin "${origin}"
  local key; key="$(get_kv SECRET_ENCRYPTION_KEY)"
  [ "$(printf '%s' "${key}" | base64 -d 2>/dev/null | wc -c)" -eq 32 ] \
    || die "SECRET_ENCRYPTION_KEY must decode to 32 bytes"
  log "pulling images…"; compose pull
  log "starting the stack…"; compose up -d --wait
  local origin_url; origin_url="$(get_kv PUBLIC_ORIGIN)"
  log "running smoke test…"
  smoke_test "${origin_url}"
  log "NodeScope is up at ${origin_url}"
  log "create your first account there, then point the desktop app at ${origin_url}/api"
}

# End-to-end reachability through the real origin (Caddy -> API / static files) -
# what the containers' own healthchecks cannot see. curl-only, so the appliance
# host needs no toolchain. Exits via die on the first failed check.
smoke_test() {
  local origin="$1"
  local body

  # API readiness through the proxy.
  curl -fsS --retry 10 --retry-delay 2 --retry-all-errors "${origin}/api/health" >/dev/null \
    || die "smoke: ${origin}/api/health is not answering"
  log "  ✔ API /api/health"

  # Unauthenticated get-session must be HTTP 200 with a literal JSON null body.
  body="$(curl -fsS "${origin}/api/auth/get-session")" && [ "${body}" = "null" ] \
    || die "smoke: /api/auth/get-session should return null, got: ${body}"
  log "  ✔ API /api/auth/get-session (unauthenticated)"

  # The web shell and the SPA catchall both serve index.html.
  curl -fsS "${origin}/" | grep -qi "<html" \
    || die "smoke: ${origin}/ did not serve the web shell"
  log "  ✔ Web / (index.html)"
  curl -fsS "${origin}/__catchall_smoke" | grep -qi "<html" \
    || die "smoke: SPA catchall did not serve index.html"
  log "  ✔ Web SPA catchall"
}

cmd_reconfigure() {
  local origin=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --origin) [ $# -ge 2 ] || die "--origin requires a value"; origin="$2"; shift 2 ;;
      --web-port) [ $# -ge 2 ] || die "--web-port requires a value"; set_kv WEB_PORT "$2"; shift 2 ;;
      *) die "unknown reconfigure option: $1" ;;
    esac
  done
  [ -f "${ENV_FILE}" ] || die "no ${ENV_FILE}; run 'install' first"
  set_origin "${origin}"
  log "restarting with the new origin (no rebuild)…"
  compose up -d
  log "done — reachable at $(get_kv PUBLIC_ORIGIN)"
}

cmd_status() { compose ps; }
cmd_logs() { compose logs "$@"; }
cmd_up() { compose up -d --wait; }
cmd_down() { compose down; }

usage() { sed -n '2,12p' "${BASH_SOURCE[0]}"; }

main() {
  local sub="${1:-}"; shift || true
  case "${sub}" in
    install)     cmd_install "$@" ;;
    reconfigure) cmd_reconfigure "$@" ;;
    status)      cmd_status "$@" ;;
    logs)        cmd_logs "$@" ;;
    up)          cmd_up "$@" ;;
    down)        cmd_down "$@" ;;
    ""|-h|--help|help) usage ;;
    *) die "unknown command: ${sub} (try --help)" ;;
  esac
}

# Only dispatch when executed, not when sourced (tests source this file).
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
