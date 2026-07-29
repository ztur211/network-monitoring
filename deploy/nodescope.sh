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
#   ./deploy/nodescope.sh enable-boot    # install and enable the systemd unit (needs root)
#   ./deploy/nodescope.sh disable-boot   # remove the systemd unit
#   ./deploy/nodescope.sh backup [dir]   # DB and blobs bundle, pruned to BACKUP_KEEP
#   ./deploy/nodescope.sh restore <dir>  # restore a bundle
#   ./deploy/nodescope.sh enable-backups # install and enable the daily backup timer (needs root)
#   ./deploy/nodescope.sh disable-backups
#   ./deploy/nodescope.sh update [tag]   # backup, pull, restart, and verify
#   ./deploy/nodescope.sh rollback [dir] # restore a backup and its recorded image tag
#   ./deploy/nodescope.sh offsite-keygen
#   ./deploy/nodescope.sh offsite-push [bundle]
#   ./deploy/nodescope.sh offsite-list
#   ./deploy/nodescope.sh offsite-pull <name> [destination] --identity <file>
#   ./deploy/nodescope.sh offsite-restore <name> --identity <file>
set -euo pipefail
umask 077

# shellcheck disable=SC1007 # CDPATH= is an intentional prefix-assignment, not a typo
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Overridable so tests can point at a temp env file.
ENV_FILE="${NODESCOPE_ENV_FILE:-${SCRIPT_DIR}/.env}"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.prod.yml"
WEB_PORT_DEFAULT=8080

compose() { docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"; }
log() { printf '[nodescope] %s\n' "$*" >&2; }
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
gen_database_secret() { openssl rand -hex 32; }

# Fill any missing secret / default WITHOUT overwriting existing values, so
# re-running install is safe (idempotent).
ensure_env() {
  touch "${ENV_FILE}"
  [ -n "$(get_kv POSTGRES_USER)" ]         || set_kv POSTGRES_USER nodescope
  [ -n "$(get_kv POSTGRES_DB)" ]           || set_kv POSTGRES_DB nodescope
  [ -n "$(get_kv POSTGRES_PASSWORD)" ]     || set_kv POSTGRES_PASSWORD "$(gen_database_secret)"
  [ -n "$(get_kv SECRET_ENCRYPTION_KEY)" ] || set_kv SECRET_ENCRYPTION_KEY "$(gen_secret 32)"
  [ -n "$(get_kv BOOTSTRAP_TOKEN)" ]       || set_kv BOOTSTRAP_TOKEN "$(gen_secret 24)"
  [ -n "$(get_kv STORAGE_DRIVER)" ]        || set_kv STORAGE_DRIVER fs
  [ -n "$(get_kv NODESCOPE_VERSION)" ]     || set_kv NODESCOPE_VERSION latest
  [ -n "$(get_kv WEB_PORT)" ]              || set_kv WEB_PORT "${WEB_PORT_DEFAULT}"
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

# --- systemd unit rendering -------------------------------------------------

render_unit() { # render_unit <template-file> <deploy-dir> -> unit text on stdout
  sed "s#__DEPLOY_DIR__#$2#g" "$1"
}

require_systemd_root() {
  command -v systemctl >/dev/null 2>&1 \
    || die "systemctl was not found; use the documented manual or cron path on non-systemd hosts"
  [ -w /etc/systemd/system ] \
    || die "writing systemd units needs root; re-run this command with sudo"
}

# --- backup helpers ---------------------------------------------------------

write_manifest() { # write_manifest <bundle-dir> <version> <migration> <timestamp>
  printf 'nodescope_version=%s\nmigration=%s\ntimestamp=%s\n' "$2" "$3" "$4" > "$1/manifest.txt"
}

manifest_version() { # manifest_version <bundle-dir> -> recorded version, or nothing
  [ -f "$1/manifest.txt" ] || return 0
  sed -n 's/^nodescope_version=//p' "$1/manifest.txt" | head -n1
}

prune_backups() { # prune_backups <dir> <keep>
  local dir="$1" keep="${2:-7}" old
  case "${keep}" in
    ''|*[!0-9]*) keep=7 ;;
  esac
  [ "${keep}" -ge 1 ] || keep=7

  find "${dir}" -mindepth 1 -maxdepth 1 -type d -name 'nodescope-*' -print \
    | sort -r \
    | tail -n "+$((keep + 1))" \
    | while IFS= read -r old; do
        [ -n "${old}" ] && rm -rf -- "${old}"
      done
}

latest_bundle() { # latest_bundle <dir> -> newest bundle path, or nothing
  [ -d "$1" ] || return 0
  find "$1" -mindepth 1 -maxdepth 1 -type d -name 'nodescope-*' -print \
    | sort \
    | tail -n1
}

# --- offsite backup helpers -------------------------------------------------

offsite_cli() { # offsite_cli <mount-dir-or-empty> <ro|rw> <command> [args]
  local mount="$1" access="$2"
  shift 2
  local -a volume=()
  if [ -n "${mount}" ]; then
    volume=(
      --user "$(id -u):$(id -g)"
      --volume "${mount}:/work:${access}"
    )
  fi

  OFFSITE_BACKUP_PUBKEY="${OFFSITE_BACKUP_PUBKEY:-$(get_kv OFFSITE_BACKUP_PUBKEY)}" \
  OFFSITE_S3_ENDPOINT="$(get_kv OFFSITE_S3_ENDPOINT)" \
  OFFSITE_S3_REGION="$(get_kv OFFSITE_S3_REGION)" \
  OFFSITE_S3_BUCKET="$(get_kv OFFSITE_S3_BUCKET)" \
  OFFSITE_S3_ACCESS_KEY="$(get_kv OFFSITE_S3_ACCESS_KEY)" \
  OFFSITE_S3_SECRET_KEY="$(get_kv OFFSITE_S3_SECRET_KEY)" \
  OFFSITE_S3_PREFIX="$(get_kv OFFSITE_S3_PREFIX)" \
  OFFSITE_KEEP="$(get_kv OFFSITE_KEEP)" \
  OFFSITE_INCLUDE_BLOBS="$(get_kv OFFSITE_INCLUDE_BLOBS)" \
  OFFSITE_IDENTITY="${OFFSITE_IDENTITY:-}" \
  compose run --rm --no-deps --entrypoint dotnet \
    -e OFFSITE_BACKUP_PUBKEY \
    -e OFFSITE_S3_ENDPOINT \
    -e OFFSITE_S3_REGION \
    -e OFFSITE_S3_BUCKET \
    -e OFFSITE_S3_ACCESS_KEY \
    -e OFFSITE_S3_SECRET_KEY \
    -e OFFSITE_S3_PREFIX \
    -e OFFSITE_KEEP \
    -e OFFSITE_INCLUDE_BLOBS \
    -e OFFSITE_IDENTITY \
    "${volume[@]}" \
    api /opt/nodescope-backup/NodeScope.Backup.dll "$@"
}

# --- commands ---------------------------------------------------------------

preflight() {
  command -v docker >/dev/null 2>&1 || die "docker is not installed"
  docker compose version >/dev/null 2>&1 || die "the docker compose plugin is not installed"
  command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets"
  command -v curl >/dev/null 2>&1 || die "curl is required for appliance verification"
  command -v gzip >/dev/null 2>&1 || die "gzip is required for backup and restore"
  command -v gunzip >/dev/null 2>&1 || die "gunzip is required for restore"
  command -v tar >/dev/null 2>&1 || die "tar is required for backup validation"
}

cmd_install() {
  local origin="" tiles=1 enable_boot=0 enable_backups=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --origin) [ $# -ge 2 ] || die "--origin requires a value"; origin="$2"; shift 2 ;;
      --web-port) [ $# -ge 2 ] || die "--web-port requires a value"; set_kv WEB_PORT "$2"; shift 2 ;;
      --no-tiles) tiles=0; shift ;;
      --enable-boot) enable_boot=1; shift ;;
      --enable-backups) enable_backups=1; shift ;;
      *) die "unknown install option: $1" ;;
    esac
  done
  preflight
  if [ ! -f "${ENV_FILE}" ] && docker volume inspect nodescope_pgdata >/dev/null 2>&1; then
    die "${ENV_FILE} is missing while the NodeScope database volume exists; restore the appliance env file before installing again"
  fi
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
  log "open the native desktop app and enter ${origin_url}"
  log "first-organization bootstrap code: $(get_kv BOOTSTRAP_TOKEN)"
  [ "${enable_boot}" -eq 0 ] || cmd_enable_boot
  [ "${enable_backups}" -eq 0 ] || cmd_enable_backups
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

  # The auth stack answers anonymous callers with the enveloped 401 (AUTH_002),
  # which proves the whole session pipeline is wired without needing credentials.
  body="$(curl -s "${origin}/api/v1/users/me")"
  printf '%s' "${body}" | grep -q "AUTH_002" \
    || die "smoke: unauthenticated /api/v1/users/me should be the AUTH_002 envelope, got: ${body}"
  log "  ✔ API auth stack (anonymous 401 envelope)"

  # No browser surface exists: the desktop signs in natively against /api/v1/auth,
  # so the root - like every junk path - must be an honest 404 (the agent's
  # update check and the desktop's error mapping both rely on never seeing HTML
  # where JSON belongs).
  [ "$(curl -s -o /dev/null -w '%{http_code}' "${origin}/")" = "404" ] \
    || die "smoke: ${origin}/ should 404 - no browser surface exists"
  log "  ✔ Root serves no browser surface (404)"

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

cmd_enable_boot() {
  require_systemd_root
  render_unit "${SCRIPT_DIR}/nodescope.service" "${SCRIPT_DIR}" \
    > /etc/systemd/system/nodescope.service
  systemctl daemon-reload
  systemctl enable --now nodescope.service
  log "boot auto-start enabled (check with: systemctl status nodescope)"
}

cmd_disable_boot() {
  require_systemd_root
  systemctl disable --now nodescope.service 2>/dev/null || true
  rm -f /etc/systemd/system/nodescope.service
  systemctl daemon-reload
  log "boot auto-start disabled"
}

cmd_backup() { # cmd_backup [output-dir]
  [ -f "${ENV_FILE}" ] || die "no ${ENV_FILE}; run 'install' first"

  local out="${1:-$(get_kv BACKUP_DIR)}" ts bundle suffix=0
  [ -n "${out}" ] || out="${SCRIPT_DIR}/backups"
  mkdir -p "${out}"
  out="$(cd "${out}" && pwd)"
  ts="$(date -u +%Y%m%d-%H%M%S)"
  bundle="${out}/nodescope-${ts}"
  while [ -e "${bundle}" ]; do
    suffix=$((suffix + 1))
    bundle="${out}/nodescope-${ts}-${suffix}"
  done
  mkdir "${bundle}"

  log "dumping database"
  # The database variables expand inside the container, not on the host.
  # shellcheck disable=SC2016
  if ! compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
    | gzip > "${bundle}/db.sql.gz"; then
    rm -rf -- "${bundle}"
    die "database dump failed; is the stack running?"
  fi
  if [ "$(wc -c < "${bundle}/db.sql.gz")" -lt 100 ]; then
    rm -rf -- "${bundle}"
    die "database dump is implausibly small"
  fi

  log "archiving blob storage"
  if ! compose run --rm --no-deps --entrypoint sh api \
    -c 'tar czf - -C /data/storage .' > "${bundle}/blobs.tar.gz"; then
    rm -rf -- "${bundle}"
    die "blob archive failed"
  fi
  [ -s "${bundle}/blobs.tar.gz" ] || {
    rm -rf -- "${bundle}"
    die "blob archive is missing or empty"
  }

  local version migration
  version="$(get_kv NODESCOPE_VERSION)"
  [ -n "${version}" ] || version="unknown"
  # The identifiers and database variables expand inside the container.
  # shellcheck disable=SC2016
  migration="$(compose exec -T db sh -c \
    'psql -tAqX -U "$POSTGRES_USER" "$POSTGRES_DB" -c '"'"'SELECT "MigrationId" FROM "__EFMigrationsHistory" ORDER BY "MigrationId" DESC LIMIT 1'"'"'' \
    2>/dev/null | tr -d '[:space:]')"
  [ -n "${migration}" ] || migration="unknown"
  write_manifest "${bundle}" "${version}" "${migration}" "${ts}"

  prune_backups "${out}" "$(get_kv BACKUP_KEEP)"
  log "backup written: ${bundle}"
  printf '%s\n' "${bundle}"
}

cmd_restore() { # cmd_restore <bundle-dir> [--database-only]
  local bundle="${1:-}" database_only=0
  if [ "${2:-}" = "--database-only" ]; then
    database_only=1
  elif [ -n "${2:-}" ]; then
    die "unknown restore option: $2"
  fi
  [ -n "${bundle}" ] || die "usage: nodescope.sh restore <bundle-dir>"
  [ -d "${bundle}" ] || die "no such bundle: ${bundle}"
  [ -s "${bundle}/db.sql.gz" ] || die "bundle is missing db.sql.gz"
  [ -s "${bundle}/manifest.txt" ] || die "bundle is missing manifest.txt"
  if [ ! -s "${bundle}/blobs.tar.gz" ] && [ "${database_only}" -eq 0 ]; then
    die "bundle is missing blobs.tar.gz"
  fi
  bundle="$(cd "${bundle}" && pwd)"
  gzip --test "${bundle}/db.sql.gz" || die "bundle database dump is corrupt"
  if [ -s "${bundle}/blobs.tar.gz" ]; then
    tar --list --gzip --file "${bundle}/blobs.tar.gz" >/dev/null \
      || die "bundle blob archive is corrupt"
  fi

  log "stopping the API to release database connections"
  compose stop api

  log "recreating the database"
  # The database variables expand inside the container.
  # shellcheck disable=SC2016
  compose exec -T db sh -c \
    'dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'

  log "restoring database"
  # The database variables expand inside the container.
  # shellcheck disable=SC2016
  compose exec -T db sh -c \
    'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS timescaledb; SELECT timescaledb_pre_restore();"'
  # shellcheck disable=SC2016
  gunzip --stdout "${bundle}/db.sql.gz" \
    | compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -v ON_ERROR_STOP=1'
  # shellcheck disable=SC2016
  compose exec -T db sh -c \
    'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "SELECT timescaledb_post_restore();"'

  log "restoring blob storage"
  if [ -s "${bundle}/blobs.tar.gz" ]; then
    gunzip --stdout "${bundle}/blobs.tar.gz" \
      | compose run --rm --no-deps --entrypoint sh api -c \
        'find /data/storage -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar xf - -C /data/storage'
  else
    log "database-only backup: clearing blob storage"
    compose run --rm --no-deps --entrypoint sh api -c \
      'find /data/storage -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
  fi

  log "starting the stack"
  compose up -d --wait
  log "restore complete from ${bundle}"
}

cmd_enable_backups() {
  require_systemd_root
  render_unit "${SCRIPT_DIR}/nodescope-backup.service" "${SCRIPT_DIR}" \
    > /etc/systemd/system/nodescope-backup.service
  render_unit "${SCRIPT_DIR}/nodescope-backup.timer" "${SCRIPT_DIR}" \
    > /etc/systemd/system/nodescope-backup.timer
  systemctl daemon-reload
  systemctl enable --now nodescope-backup.timer
  log "daily backups enabled (check with: systemctl list-timers nodescope-backup.timer)"
}

cmd_disable_backups() {
  require_systemd_root
  systemctl disable --now nodescope-backup.timer 2>/dev/null || true
  rm -f /etc/systemd/system/nodescope-backup.timer
  rm -f /etc/systemd/system/nodescope-backup.service
  systemctl daemon-reload
  log "daily backups disabled"
}

cmd_offsite_keygen() {
  local force=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --force) force=1; shift ;;
      *) die "unknown offsite-keygen option: $1" ;;
    esac
  done
  [ -f "${ENV_FILE}" ] || die "no ${ENV_FILE}; run 'install' first"
  if [ -n "$(get_kv OFFSITE_BACKUP_PUBKEY)" ] && [ "${force}" -eq 0 ]; then
    die "an offsite public key already exists; replacing it makes existing backups unrecoverable (pass --force to confirm)"
  fi

  local generated public_key private_key identity_file
  generated="$(offsite_cli "" ro keygen)"
  public_key="$(printf '%s\n' "${generated}" | sed -n 's/^PUBKEY=//p' | head -n1)"
  private_key="$(printf '%s\n' "${generated}" | sed -n 's/^PRIVKEY=//p' | head -n1)"
  if [ -z "${public_key}" ] || [ -z "${private_key}" ]; then
    die "offsite key generation did not return a complete identity"
  fi

  set_kv OFFSITE_BACKUP_PUBKEY "${public_key}"
  identity_file="${SCRIPT_DIR}/offsite-identity.key"
  {
    printf 'NODESCOPE_OFFSITE_IDENTITY_V1\n'
    printf 'PUBKEY=%s\n' "${public_key}"
    printf 'PRIVKEY=%s\n' "${private_key}"
  } > "${identity_file}"
  chmod 600 "${identity_file}"

  log "offsite public key stored in ${ENV_FILE}"
  log "RECOVERY KEY: ${identity_file}"
  log "Copy this file to secure storage off this appliance, verify the copy, then remove the appliance copy."
  log "Without this recovery key, encrypted offsite backups cannot be restored."
}

cmd_offsite_push() {
  if [ -z "$(get_kv OFFSITE_BACKUP_PUBKEY)" ] \
    || [ -z "$(get_kv OFFSITE_S3_BUCKET)" ] \
    || [ -z "$(get_kv OFFSITE_S3_ACCESS_KEY)" ] \
    || [ -z "$(get_kv OFFSITE_S3_SECRET_KEY)" ]; then
    log "offsite backup is not configured; skipping push"
    return 0
  fi

  local backup_dir bundle parent name
  backup_dir="$(get_kv BACKUP_DIR)"
  [ -n "${backup_dir}" ] || backup_dir="${SCRIPT_DIR}/backups"
  bundle="${1:-$(latest_bundle "${backup_dir}")}"
  if [ -z "${bundle}" ] || [ ! -d "${bundle}" ]; then
    die "no local backup bundle was found in ${backup_dir}"
  fi
  bundle="$(cd "${bundle}" && pwd)"
  parent="$(dirname "${bundle}")"
  name="$(basename "${bundle}")"

  log "encrypting and uploading ${name}"
  offsite_cli "${parent}" ro push "/work/${name}"
}

cmd_offsite_list() {
  [ -n "$(get_kv OFFSITE_S3_BUCKET)" ] || die "OFFSITE_S3_BUCKET is not configured"
  offsite_cli "" ro list
}

cmd_offsite_pull() {
  local name="" destination="" identity_file="${SCRIPT_DIR}/offsite-identity.key"
  while [ $# -gt 0 ]; do
    case "$1" in
      --identity)
        [ $# -ge 2 ] || die "--identity requires a file"
        identity_file="$2"
        shift 2
        ;;
      *)
        if [ -z "${name}" ]; then
          name="$1"
        elif [ -z "${destination}" ]; then
          destination="$1"
        else
          die "too many offsite-pull arguments"
        fi
        shift
        ;;
    esac
  done

  [ -n "${name}" ] \
    || die "usage: nodescope.sh offsite-pull <name> [destination] --identity <file>"
  [ -f "${identity_file}" ] \
    || die "recovery identity not found: ${identity_file}"
  [ -n "$(get_kv OFFSITE_S3_BUCKET)" ] || die "OFFSITE_S3_BUCKET is not configured"

  local public_key private_key destination_parent destination_name
  public_key="$(sed -n 's/^PUBKEY=//p' "${identity_file}" | head -n1)"
  private_key="$(sed -n 's/^PRIVKEY=//p' "${identity_file}" | head -n1)"
  [ -n "${public_key}" ] || die "the recovery identity has no public key"
  [ -n "${private_key}" ] || die "the recovery identity has no private key"

  [ -n "${destination}" ] || destination="${SCRIPT_DIR}/backups/${name}"
  [ ! -e "${destination}" ] || die "restore destination already exists: ${destination}"
  destination_parent="$(dirname "${destination}")"
  destination_name="$(basename "${destination}")"
  mkdir -p "${destination_parent}"
  destination_parent="$(cd "${destination_parent}" && pwd)"

  OFFSITE_BACKUP_PUBKEY="${public_key}" \
  OFFSITE_IDENTITY="${private_key}" \
    offsite_cli "${destination_parent}" rw pull "${name}" "/work/${destination_name}"
  printf '%s\n' "${destination_parent}/${destination_name}"
}

cmd_offsite_restore() {
  local destination
  destination="$(cmd_offsite_pull "$@")"
  if [ -s "${destination}/blobs.tar.gz" ]; then
    cmd_restore "${destination}"
  else
    log "restoring a database-only offsite backup; blob storage will be empty"
    cmd_restore "${destination}" --database-only
  fi
}

cmd_update() { # cmd_update [version]
  local requested="${1:-}" bundle previous origin_url has_tiles=0 failed_stage=""
  log "backing up before update"
  bundle="$(cmd_backup)"
  previous="$(get_kv NODESCOPE_VERSION)"
  [ -n "${previous}" ] || previous="latest"
  [ -z "${requested}" ] || set_kv NODESCOPE_VERSION "${requested}"
  origin_url="$(get_kv PUBLIC_ORIGIN)"

  log "pulling images (${requested:-current pin})"
  if ! compose pull; then
    failed_stage="image pull"
  fi

  if [ -z "${failed_stage}" ]; then
    log "applying update"
    if ! compose up -d --wait; then
      failed_stage="stack startup"
    fi
  fi

  if [ -z "${failed_stage}" ]; then
    if tiles_extract_exists; then
      has_tiles=1
    fi
    log "verifying update"
    if ! (smoke_test "${origin_url%/}" "${has_tiles}"); then
      failed_stage="smoke verification"
    fi
  fi

  if [ -n "${failed_stage}" ]; then
    set_kv NODESCOPE_VERSION "${previous}"
    die "update failed during ${failed_stage} and the image pin was restored to ${previous}; recover with: ./deploy/nodescope.sh rollback ${bundle}"
  fi

  log "update succeeded; rollback to ${previous} with: ./deploy/nodescope.sh rollback ${bundle}"
}

cmd_rollback() { # cmd_rollback [bundle-dir]
  local backup_dir bundle previous
  backup_dir="$(get_kv BACKUP_DIR)"
  [ -n "${backup_dir}" ] || backup_dir="${SCRIPT_DIR}/backups"
  bundle="${1:-$(latest_bundle "${backup_dir}")}"
  if [ -z "${bundle}" ] || [ ! -d "${bundle}" ]; then
    die "no backup bundle was found in ${backup_dir}"
  fi
  previous="$(manifest_version "${bundle}")"
  [ -n "${previous}" ] || previous="latest"
  set_kv NODESCOPE_VERSION "${previous}"
  log "restoring ${bundle} and pinning image tag ${previous}"
  log "pulling rollback images"
  compose pull
  cmd_restore "${bundle}"
  log "rollback complete"
}

usage() { sed -n '2,/^[^#]/p' "${BASH_SOURCE[0]}" | sed '$d'; }

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
    enable-boot) cmd_enable_boot "$@" ;;
    disable-boot) cmd_disable_boot "$@" ;;
    backup)      cmd_backup "$@" ;;
    restore)     cmd_restore "$@" ;;
    enable-backups) cmd_enable_backups "$@" ;;
    disable-backups) cmd_disable_backups "$@" ;;
    update)      cmd_update "$@" ;;
    rollback)    cmd_rollback "$@" ;;
    offsite-keygen) cmd_offsite_keygen "$@" ;;
    offsite-push) cmd_offsite_push "$@" ;;
    offsite-list) cmd_offsite_list "$@" ;;
    offsite-pull) cmd_offsite_pull "$@" ;;
    offsite-restore) cmd_offsite_restore "$@" ;;
    ""|-h|--help|help) usage ;;
    *) die "unknown command: ${sub} (try --help)" ;;
  esac
}

# Only dispatch when executed, not when sourced (tests source this file).
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
