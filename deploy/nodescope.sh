#!/usr/bin/env bash
#
# NodeScope appliance manager - one-command install + lifecycle for the
# self-hosted site server (deploy/docker-compose.prod.yml).
#
#   ./deploy/nodescope.sh install       # generate secrets, detect LAN IP, bring the stack up, smoke-test
#   ./deploy/nodescope.sh tiles         # build the map-tile region extract (TILES_AREA/TILES_BBOX in .env)
#   ./deploy/nodescope.sh reconfigure   # re-detect / change the LAN origin, then restart (no rebuild)
#   ./deploy/nodescope.sh status        # docker compose ps
#   ./deploy/nodescope.sh logs [svc]    # tail logs
#   ./deploy/nodescope.sh up | down     # start / stop the stack
#   ./deploy/nodescope.sh smoke         # verify the running same-origin stack
#
# Backup, restore and update land in Phase 2.
set -euo pipefail

# shellcheck disable=SC1007 # CDPATH= is an intentional prefix-assignment, not a typo
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
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
  # Map region (Decision 15): defaults cover the demo seed's NYC devices.
  # TILES_BBOX may be legitimately empty (= the whole TILES_AREA), so only seed it.
  [ -n "$(get_kv TILES_AREA)" ]            || set_kv TILES_AREA new-york
  grep -q '^TILES_BBOX=' "${ENV_FILE}"     || set_kv TILES_BBOX "-74.28,40.48,-73.65,40.95"
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
  local origin="" tiles=1
  while [ $# -gt 0 ]; do
    case "$1" in
      --origin) [ $# -ge 2 ] || die "--origin requires a value"; origin="$2"; shift 2 ;;
      --web-port) [ $# -ge 2 ] || die "--web-port requires a value"; set_kv WEB_PORT "$2"; shift 2 ;;
      --no-tiles) tiles=0; shift ;;
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
  # Region build BEFORE up: the tiles service only registers the liberty style
  # when region.mbtiles exists (it stays healthy but 404s styles without it),
  # and the smoke test asserts the style is served. Idempotent re-installs skip
  # this instantly when the extract is already on the volume.
  if [ "${tiles}" -eq 1 ]; then
    cmd_tiles
  else
    log "skipped map tiles (--no-tiles); run './deploy/nodescope.sh tiles' later"
  fi
  log "starting the stack…"; compose up -d --wait
  local origin_url; origin_url="$(get_kv PUBLIC_ORIGIN)"
  log "running smoke test…"
  smoke_test "${origin_url}" "${tiles}"
  log "NodeScope is up at ${origin_url}"
  log "create your first account there, then enter ${origin_url} in the desktop app"
}

# Build the map-tile region extract (Decision 15). One-shot planetiler run that
# writes region.mbtiles onto the tiledata volume; idempotent - an existing
# extract is kept unless --rebuild. The tiles service picks the file up on
# restart, which this handles when the service is running.
cmd_tiles() {
  local rebuild=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --rebuild) rebuild=1; shift ;;
      *) die "unknown tiles option: $1" ;;
    esac
  done
  [ -f "${ENV_FILE}" ] || die "no ${ENV_FILE}; run 'install' first"
  local area bbox
  area="$(get_kv TILES_AREA)"
  bbox="$(get_kv TILES_BBOX)"
  [ -n "${area}" ] || die "TILES_AREA is empty; set a Geofabrik slug in ${ENV_FILE}"

  if [ "${rebuild}" -eq 0 ] && tiles_extract_exists; then
    log "map tiles: region.mbtiles already on the tiledata volume (use 'tiles --rebuild' to regenerate)"
    return 0
  fi

  log "map tiles: building '${area}'${bbox:+ (bbox ${bbox})} - downloads OSM data once, takes minutes…"
  local -a args=(--download --area="${area}" --output=/data/region.mbtiles --force)
  [ -n "${bbox}" ] && args+=(--bounds="${bbox}")
  compose --profile tilesbuild run --rm tiles-build "${args[@]}" \
    || die "map tiles: planetiler failed (see output above)"
  # Drop planetiler's source downloads + scratch space - only the extract serves.
  compose --profile tilesbuild run --rm --entrypoint /bin/sh tiles-build \
    -c 'rm -rf /data/sources /data/data /data/tmp' >/dev/null
  # A running tiles service registers the new mbtiles on restart.
  if [ -n "$(compose ps -q tiles 2>/dev/null)" ]; then
    compose restart tiles >/dev/null
  fi
  log "map tiles: region extract ready"
}

# True if the tiledata volume already carries region.mbtiles. Probed with the
# tiles image (its runtime is node; the entrypoint is bypassed so nothing serves).
tiles_extract_exists() {
  compose run --rm --no-deps --entrypoint node tiles \
    -e "process.exit(require('fs').existsSync('/data/region.mbtiles') ? 0 : 1)" >/dev/null 2>&1
}

# End-to-end reachability through the real origin (Caddy -> API / tiles / agent
# payload) - what the containers' own healthchecks cannot see. curl-only, so the
# appliance host needs no toolchain. Exits via die on the first failed check.
smoke_test() {
  local origin="$1" tiles="${2:-1}"
  local body

  # API readiness through the proxy.
  curl -fsS --retry 10 --retry-delay 2 --retry-all-errors "${origin}/api/health" >/dev/null \
    || die "smoke: ${origin}/api/health is not answering"
  log "  ✔ API /api/health"

  # Unauthenticated get-session must be HTTP 200 with a literal JSON null body.
  if ! body="$(curl -fsS "${origin}/api/auth/get-session")"; then
    die "smoke: /api/auth/get-session is not answering"
  fi
  [ "${body}" = "null" ] \
    || die "smoke: /api/auth/get-session should return null, got: ${body}"
  log "  ✔ API /api/auth/get-session (unauthenticated)"

  # The browser auth page: / redirects onto /login, which the API serves itself
  # (step 6: no SPA). -L follows the redirect; the page is the desktop-auth
  # flow's sign-in bounce target, so a broken page strands every new sign-in.
  curl -fsSL "${origin}/" | grep -q "auth-form" \
    || die "smoke: ${origin}/ did not serve the auth page"
  log "  ✔ Auth page / -> /login"

  # No SPA catchall exists anymore: junk paths must be an honest 404 (the agent's
  # update check and the desktop's error mapping both rely on never seeing HTML
  # where JSON belongs).
  [ "$(curl -s -o /dev/null -w '%{http_code}' "${origin}/__catchall_smoke")" = "404" ] \
    || die "smoke: an unknown path should 404, not serve a catchall"
  log "  ✔ Unknown paths 404"

  # Tileserver alive through the proxy; the style only registers once the
  # region extract exists, so that check is skipped on --no-tiles installs.
  curl -fsS "${origin}/tiles/health" >/dev/null \
    || die "smoke: ${origin}/tiles/health is not answering"
  log "  ✔ Tiles /tiles/health"
  if [ "${tiles}" -eq 1 ]; then
    curl -fsS "${origin}/tiles/styles/liberty/style.json" | grep -q "NodeScope Liberty" \
      || die "smoke: /tiles/styles/liberty/style.json did not serve the product style"
    log "  ✔ Tiles liberty style"
  fi
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
  log "done - reachable at $(get_kv PUBLIC_ORIGIN)"
}

cmd_smoke() {
  local origin="" tiles=1
  while [ $# -gt 0 ]; do
    case "$1" in
      --origin) [ $# -ge 2 ] || die "--origin requires a value"; origin="$2"; shift 2 ;;
      --no-tiles) tiles=0; shift ;;
      *) die "unknown smoke option: $1" ;;
    esac
  done

  command -v curl >/dev/null 2>&1 || die "curl is required for the smoke test"
  if [ -z "${origin}" ]; then
    [ -f "${ENV_FILE}" ] || die "no ${ENV_FILE}; pass --origin or run 'install' first"
    origin="$(get_kv PUBLIC_ORIGIN)"
  fi
  [ -n "${origin}" ] || die "PUBLIC_ORIGIN is empty; pass --origin"
  smoke_test "${origin%/}" "${tiles}"
  log "smoke test passed for ${origin%/}"
}

cmd_status() { compose ps; }
cmd_logs() { compose logs "$@"; }
cmd_up() { compose up -d --wait; }
cmd_down() { compose down; }

usage() { sed -n '2,13p' "${BASH_SOURCE[0]}"; }

main() {
  local sub="${1:-}"; shift || true
  case "${sub}" in
    install)     cmd_install "$@" ;;
    tiles)       cmd_tiles "$@" ;;
    reconfigure) cmd_reconfigure "$@" ;;
    smoke)       cmd_smoke "$@" ;;
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
