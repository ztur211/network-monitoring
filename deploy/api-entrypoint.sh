#!/bin/sh
# Applies pending database migrations, then starts the NodeScope API.
# `prisma migrate deploy` is idempotent — it only applies migrations not yet
# recorded in the _prisma_migrations table, so it is safe on every boot.
# TimescaleModule additionally ensures the hypertable/compression/retention on
# startup (also idempotent).
set -e

echo "[entrypoint] applying database migrations (prisma migrate deploy)…"
node_modules/.bin/prisma migrate deploy --schema=apps/api/prisma/schema.prisma

echo "[entrypoint] starting NodeScope API…"
exec node apps/api/dist/main.js
