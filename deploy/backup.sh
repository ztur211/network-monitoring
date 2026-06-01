#!/bin/sh
# Dump the NodeScope demo database to a timestamped, gzipped pg_dump.
#
#   Usage:  deploy/backup.sh [output-dir]        (default: ./backups)
#   Cron:   0 3 * * *  /path/to/deploy/backup.sh /var/backups/nodescope
#
# Runs pg_dump inside the db container (credentials come from the compose env),
# streams it to the host, and gzips it. Restore with:
#   gunzip -c <file>.sql.gz | docker compose -f deploy/docker-compose.prod.yml \
#     --env-file deploy/.env exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
set -eu

DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
OUT_DIR="${1:-./backups}"
COMPOSE="docker compose -f ${DIR}/docker-compose.prod.yml --env-file ${DIR}/.env"

mkdir -p "$OUT_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
FILE="${OUT_DIR}/nodescope-${TS}.sql.gz"

# pg_dump reads POSTGRES_USER / POSTGRES_DB from the container's own env.
$COMPOSE exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$FILE"

# Guard against a silently-empty dump (e.g. db not running): a real dump gzips
# to well over 100 bytes; an empty/errored one is ~20.
SIZE="$(wc -c < "$FILE")"
if [ "$SIZE" -lt 100 ]; then
  echo "[backup] ERROR: backup is only ${SIZE} bytes — is the db container up?" >&2
  rm -f "$FILE"
  exit 1
fi

echo "[backup] wrote ${FILE} ($(du -h "$FILE" | cut -f1))"
