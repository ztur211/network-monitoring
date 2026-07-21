#!/usr/bin/env bash
#
# Runs the NestJS API as the black-box target for the C# contract suite
# (tests/NodeScope.ContractTests). Env mirrors apps/api/jest.e2e.setup.ts so the
# target behaves exactly like the known-green e2e baseline: same throwaway test DB
# (5433), Redis (6380), MinIO (9100), and NODE_ENV=test.
#
# Prereqs, in order:
#   1. docker compose -f docker-compose.test.yml up -d      # db/redis/minio
#   2. npm run build --workspace=apps/api                    # produces dist/
#   3. seed the super-admin + populated org into the test DB (see README)
#
# Then:   scripts/run-contract-target.sh
# And:    dotnet test tests/NodeScope.ContractTests
#
set -euo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgresql://nodescope:localdevpassword@localhost:5433/nodescope_test}"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-test-secret-minimum-32-characters-long-aaa}"
export BETTER_AUTH_URL="${BETTER_AUTH_URL:-http://localhost:3000}"
export FRONTEND_URL="${FRONTEND_URL:-http://localhost:8081}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6380}"
export NODE_ENV="${NODE_ENV:-test}"
export PORT="${PORT:-3000}"
export STORAGE_DRIVER="${STORAGE_DRIVER:-s3}"
export STORAGE_ENDPOINT="${STORAGE_ENDPOINT:-http://localhost:9100}"
export STORAGE_REGION="${STORAGE_REGION:-us-east-1}"
export STORAGE_BUCKET="${STORAGE_BUCKET:-nodescope-test}"
export STORAGE_ACCESS_KEY="${STORAGE_ACCESS_KEY:-minioadmin}"
export STORAGE_SECRET_KEY="${STORAGE_SECRET_KEY:-minioadmin}"
export SECRET_ENCRYPTION_KEY="${SECRET_ENCRYPTION_KEY:-$(node -e "process.stdout.write(Buffer.alloc(32,1).toString('base64'))")}"
# AI intentionally unreachable: the assistant degrades to its canned fallback.
export AI_BASE_URL="${AI_BASE_URL:-http://localhost:11434/v1}"

exec node apps/api/dist/main
