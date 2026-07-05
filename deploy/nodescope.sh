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
#   ./deploy/nodescope.sh enable-boot   # install+enable the systemd unit (auto-start on boot; needs sudo)
#   ./deploy/nodescope.sh disable-boot  # remove the systemd unit
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

# --- systemd unit rendering -------------------------------------------------

render_unit() { # render_unit <template-file> <deploy-dir> -> unit text on stdout
  sed "s#__DEPLOY_DIR__#$2#g" "$1"
}

require_systemd_root() {
  command -v systemctl >/dev/null 2>&1 || die "systemctl not found — this host has no systemd (see README for the manual/cron path)"
  [ -w /etc/systemd/system ] || die "writing systemd units needs root — re-run with sudo"
}

# --- backup helpers ---------------------------------------------------------

write_manifest() { # write_manifest <bundle-dir> <version> <migration> <timestamp>
  printf 'nodescope_version=%s\nmigration=%s\ntimestamp=%s\n' "$2" "$3" "$4" > "$1/manifest.txt"
}

manifest_version() { # manifest_version <bundle-dir> -> prints nodescope_version
  sed -n 's/^nodescope_version=//p' "$1/manifest.txt" | head -n1
}

prune_backups() { # prune_backups <dir> <keep> — remove all but the newest <keep> nodescope-* bundles
  local dir="$1" keep="${2:-7}"
  case "${keep}" in ''|*[!0-9]*) keep=7 ;; esac
  [ "${keep}" -ge 1 ] || keep=7
  local old
  # timestamp bundle names sort lexically = chronologically; newest-first, skip the newest <keep>
  # shellcheck disable=SC2012 # bundle names are plain nodescope-<timestamp>; ls+sort is fine here
  ls -1d "${dir}"/nodescope-* 2>/dev/null | sort -r | tail -n +"$((keep + 1))" | while IFS= read -r old; do
    [ -n "${old}" ] && rm -rf "${old}"
  done
  return 0
}

# --- commands ---------------------------------------------------------------

preflight() {
  command -v docker >/dev/null 2>&1 || die "docker is not installed"
  docker compose version >/dev/null 2>&1 || die "the docker compose plugin is not installed"
  command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets"
}

cmd_install() {
  local origin="" enable_boot=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --origin) [ $# -ge 2 ] || die "--origin requires a value"; origin="$2"; shift 2 ;;
      --web-port) [ $# -ge 2 ] || die "--web-port requires a value"; set_kv WEB_PORT "$2"; shift 2 ;;
      --enable-boot) enable_boot=1; shift ;;
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
  node "${REPO_ROOT}/scripts/smoke.mjs" "${origin_url}" "${origin_url}"
  log "NodeScope is up at ${origin_url}"
  log "create your first account there, then point the desktop app at ${origin_url}/api"
  [ "${enable_boot}" -eq 1 ] && cmd_enable_boot
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

cmd_enable_boot() {
  require_systemd_root
  render_unit "${SCRIPT_DIR}/nodescope.service" "${SCRIPT_DIR}" > /etc/systemd/system/nodescope.service
  systemctl daemon-reload
  systemctl enable --now nodescope.service
  log "boot auto-start enabled (check: systemctl status nodescope)"
}

cmd_disable_boot() {
  require_systemd_root
  systemctl disable --now nodescope.service 2>/dev/null || true
  rm -f /etc/systemd/system/nodescope.service
  systemctl daemon-reload
  log "boot auto-start disabled"
}

cmd_backup() { # cmd_backup [output-dir]
  local out="${1:-$(get_kv BACKUP_DIR)}"
  [ -n "${out}" ] || out="${SCRIPT_DIR}/backups"
  mkdir -p "${out}"
  out="$(cd "${out}" && pwd)"                       # absolutize (needed for the -v mount below)
  local ts bundle
  ts="$(date +%Y%m%d-%H%M%S)"
  bundle="${out}/nodescope-${ts}"
  mkdir -p "${bundle}"

  log "dumping database…"
  # shellcheck disable=SC2016 # single-quoted: expands inside the container shell, not here
  compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "${bundle}/db.sql.gz"
  [ "$(wc -c < "${bundle}/db.sql.gz")" -ge 100 ] \
    || { rm -rf "${bundle}"; die "db dump is empty — is the stack up? (nodescope.sh up)"; }

  log "archiving blob storage…"
  compose run --rm --no-deps --entrypoint sh --volume "${bundle}:/backup" api \
    -c 'tar czf /backup/blobs.tar.gz -C /data/storage .'

  local ver mig
  ver="$(get_kv NODESCOPE_VERSION)"; [ -n "${ver}" ] || ver="unknown"
  # shellcheck disable=SC2016 # single-quoted: expands inside the container shell, not here
  mig="$(compose exec -T db sh -c 'psql -tAqX -U "$POSTGRES_USER" "$POSTGRES_DB" -c "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1"' 2>/dev/null | tr -d "[:space:]")"
  [ -n "${mig}" ] || mig="unknown"
  write_manifest "${bundle}" "${ver}" "${mig}" "${ts}"

  prune_backups "${out}" "$(get_kv BACKUP_KEEP)"
  log "backup written: ${bundle}"
  printf '%s\n' "${bundle}"                          # last line = bundle path (used by update)
}

usage() { sed -n '2,/^[^#]/p' "${BASH_SOURCE[0]}" | sed '$d'; }

main() {
  local sub="${1:-}"; shift || true
  case "${sub}" in
    install)     cmd_install "$@" ;;
    reconfigure) cmd_reconfigure "$@" ;;
    status)      cmd_status "$@" ;;
    logs)        cmd_logs "$@" ;;
    up)          cmd_up "$@" ;;
    down)        cmd_down "$@" ;;
    enable-boot)  cmd_enable_boot "$@" ;;
    disable-boot) cmd_disable_boot "$@" ;;
    backup)      cmd_backup "$@" ;;
    ""|-h|--help|help) usage ;;
    *) die "unknown command: ${sub} (try --help)" ;;
  esac
}

# Only dispatch when executed, not when sourced (tests source this file).
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
