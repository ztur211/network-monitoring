#!/usr/bin/env bash
#
# Runs the C# API host (src/NodeScope.Api) in the Decision 21 transition harness:
# native endpoints served here, everything else proxied to the Node target on :3000.
# Env mirrors scripts/run-contract-target.sh so both processes read the same test
# DB and share BETTER_AUTH_SECRET (sessions minted by Node validate here).
#
# Prereqs, in order:
#   1. docker compose -f docker-compose.test.yml up -d      # db/redis/minio
#   2. scripts/run-contract-target.sh                        # Node target on :3000
#
# Then:   scripts/run-csharp-host.sh
# And:    NODESCOPE_BASE_URL=http://127.0.0.1:5199 dotnet test tests/NodeScope.ContractTests
#
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.dotnet:$PATH"

export ASPNETCORE_URLS="${ASPNETCORE_URLS:-http://127.0.0.1:5199}"
export NODESCOPE_PROXY_TARGET="${NODESCOPE_PROXY_TARGET:-http://localhost:3000}"
export DATABASE_URL="${DATABASE_URL:-postgresql://nodescope:localdevpassword@localhost:5433/nodescope_test}"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-test-secret-minimum-32-characters-long-aaa}"
export SECRET_ENCRYPTION_KEY="${SECRET_ENCRYPTION_KEY:-AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=}"
export STORAGE_ENDPOINT="${STORAGE_ENDPOINT:-http://localhost:9100}"
export STORAGE_REGION="${STORAGE_REGION:-us-east-1}"
export STORAGE_BUCKET="${STORAGE_BUCKET:-nodescope-test}"
export STORAGE_ACCESS_KEY="${STORAGE_ACCESS_KEY:-minioadmin}"
export STORAGE_SECRET_KEY="${STORAGE_SECRET_KEY:-minioadmin}"

exec dotnet run --project src/NodeScope.Api "$@"
