#!/usr/bin/env bash
# ifc-worker-harness/run.sh — one-command IFC Web Worker live-runtime check.
#
# Verifies the BUILT worker parses an IFC inside a Chromium worker over file:// — i.e. the
# packaged desktop path — without needing auth, the API, or WebGL. See README.md.
#
# Prereq: `npm run build` in apps/desktop (so out/renderer + the ifc.worker chunk exist).
# Usage:  ./run.sh [path/to/model.ifc]      # default: the wall.ifc unit-test fixture
#
# Exit 0 only on "WORKER_TEST_DONE OK".
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"          # .../apps/desktop/scripts/ifc-worker-harness
DESKTOP="$(cd "$HERE/../.." && pwd)"           # apps/desktop
REPO="$(cd "$DESKTOP/../.." && pwd)"           # repo root
RENDERER="$DESKTOP/out/renderer"
ELECTRON="$REPO/node_modules/.bin/electron"
FIXTURE="${1:-$DESKTOP/src/renderer/viewport/ifc/__tests__/fixtures/wall.ifc}"

[ -d "$RENDERER/assets" ] || { echo "ERROR: $RENDERER/assets missing — run 'npm run build' in apps/desktop first." >&2; exit 1; }
[ -x "$ELECTRON" ]        || { echo "ERROR: electron not found at $ELECTRON — run 'npm install'." >&2; exit 1; }
[ -f "$FIXTURE" ]         || { echo "ERROR: fixture not found: $FIXTURE" >&2; exit 1; }

cp "$FIXTURE" "$RENDERER/test-fixture.ifc"
node "$HERE/gen.cjs"

RUN=( "$ELECTRON" "$HERE/main.cjs" --no-sandbox )
if command -v xvfb-run >/dev/null 2>&1; then
  exec xvfb-run -a -s "-screen 0 1280x800x24" "${RUN[@]}"
else
  echo "(no xvfb-run found; assuming a display is available)" >&2
  exec "${RUN[@]}"
fi
