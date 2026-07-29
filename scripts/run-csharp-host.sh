#!/usr/bin/env bash
#
# Runs the C# API host (src/NodeScope.Api) against the test stack. On boot the host
# applies EF migrations itself (baselining a Prisma-era test DB on first contact).
#
# Prereqs:
#   1. docker compose -f docker-compose.test.yml up -d      # db/redis/minio
#
# Then:   scripts/run-csharp-host.sh
# And:    NODESCOPE_BASE_URL=http://127.0.0.1:5199 \
#           dotnet test tests/NodeScope.ContractTests
#
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.dotnet:$PATH"

export ASPNETCORE_URLS="${ASPNETCORE_URLS:-http://127.0.0.1:5199}"
export DATABASE_URL="${DATABASE_URL:-postgresql://nodescope:localdevpassword@localhost:5433/nodescope_test}"
# The suite provisions fresh users/orgs per test from one IP, far past the
# interactive-client rate limits. Lift them for the target only (non-production),
# mirroring run-contract-target.sh.
export THROTTLE_DEFAULT_LIMIT="${THROTTLE_DEFAULT_LIMIT:-100000}"
export THROTTLE_AUTH_LIMIT="${THROTTLE_AUTH_LIMIT:-100000}"
export SECRET_ENCRYPTION_KEY="${SECRET_ENCRYPTION_KEY:-AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=}"
export BOOTSTRAP_TOKEN="${BOOTSTRAP_TOKEN:-test-bootstrap-token}"
export REFRESH_INTERVAL_SECONDS="${REFRESH_INTERVAL_SECONDS:-2}"
export ALERT_EVAL_INTERVAL_SECONDS="${ALERT_EVAL_INTERVAL_SECONDS:-1}"
export ALERT_DELIVER_INTERVAL_SECONDS="${ALERT_DELIVER_INTERVAL_SECONDS:-1}"
export STORAGE_ENDPOINT="${STORAGE_ENDPOINT:-http://localhost:9100}"
export STORAGE_REGION="${STORAGE_REGION:-us-east-1}"
export STORAGE_BUCKET="${STORAGE_BUCKET:-nodescope-test}"
export STORAGE_ACCESS_KEY="${STORAGE_ACCESS_KEY:-minioadmin}"
export STORAGE_SECRET_KEY="${STORAGE_SECRET_KEY:-minioadmin}"

exec dotnet run --project src/NodeScope.Api "$@"
