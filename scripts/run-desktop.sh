#!/usr/bin/env bash
# run-desktop.sh — one command to launch the full NodeScope stack + the 3D desktop app.
#
# Automates SETUP.md end-to-end on a REAL-GPU machine (native Linux / macOS / WSLg):
#   infra (Postgres/Redis/MinIO) → .env + SECRET_ENCRYPTION_KEY → migrate → seed →
#   load FZK-Haus sample model → API (:3000) → web (:8081) → Electron 3D viewer.
#
# The desktop viewer needs a real display + GPU (for the no-freeze / picking / BCF
# checks) and PKCE sign-in opens your system browser — so run this where you have a
# GUI, not in a headless container.
#
# Idempotent: anything already running/done is detected and skipped. Re-run freely.
#
# Usage:
#   ./scripts/run-desktop.sh                # full bring-up, then open the desktop
#   ./scripts/run-desktop.sh --reset        # wipe + re-migrate + re-seed the DB first
#   ./scripts/run-desktop.sh --no-model     # don't (re)load the sample model
#   ./scripts/run-desktop.sh --desktop-only # backend already up elsewhere; just open the app
#   ./scripts/run-desktop.sh --backend-only # bring up infra+api+web, leave them running, no GUI
#   ./scripts/run-desktop.sh --stop         # stop the api/web this script started
#
# Env overrides: SEED_EMAIL, SEED_PASSWORD (defaults owner@acme.test / devpassword123)
set -euo pipefail

# ── locate repo root (script works from scripts/ or repo root) ───────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if   [ -f "$SCRIPT_DIR/package.json" ]    && grep -q '"dev:desktop"' "$SCRIPT_DIR/package.json"; then ROOT="$SCRIPT_DIR"
elif [ -f "$SCRIPT_DIR/../package.json" ] && grep -q '"dev:desktop"' "$SCRIPT_DIR/../package.json"; then ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else ROOT="$(pwd)"; fi
cd "$ROOT"

RUN_DIR="$ROOT/.run"; mkdir -p "$RUN_DIR"
STARTED_PIDS=(); KEEP_BG=0

c(){ printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
log(){  c '1;36' "▶ $*"; }
warn(){ c '1;33' "! $*"; }
die(){  c '1;31' "✖ $*" >&2; exit 1; }

compose(){ if docker compose version >/dev/null 2>&1; then docker compose "$@"; else docker-compose "$@"; fi; }
port_open(){ (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&- 3<&-; return 0; } || return 1; }
wait_port(){ # port name timeout_s
  local p="$1" name="$2" t="${3:-60}" i=0
  log "waiting for $name on :$p ..."
  while ! port_open "$p"; do i=$((i+1)); [ "$i" -ge "$t" ] && die "$name never came up on :$p (${t}s); see $RUN_DIR/"; sleep 1; done
  log "$name up on :$p"
}
start_bg(){ # name "cmd..." logfile
  local name="$1" log="$3"; local -a cmd; read -ra cmd <<<"$2"
  nohup "${cmd[@]}" >"$log" 2>&1 & local pid=$!
  disown "$pid" 2>/dev/null || true
  echo "$pid" >"$RUN_DIR/$name.pid"; STARTED_PIDS+=("$pid")
  log "started $name (pid $pid) → $log"
}

# ── args ─────────────────────────────────────────────────────────────────────
DO_INFRA=1 DO_DB=1 DO_MODEL=1 DO_API=1 DO_WEB=1 DO_DESKTOP=1 RESET=0
for a in "$@"; do case "$a" in
  --reset) RESET=1;;
  --no-model) DO_MODEL=0;;
  --desktop-only) DO_INFRA=0 DO_DB=0 DO_MODEL=0 DO_API=0 DO_WEB=0;;
  --backend-only) DO_DESKTOP=0 KEEP_BG=1;;
  --stop)
    for f in "$RUN_DIR"/api.pid "$RUN_DIR"/web.pid; do
      if [ -f "$f" ]; then kill "$(cat "$f")" 2>/dev/null && log "stopped $(basename "$f" .pid)" || true; rm -f "$f"; fi
    done
    log "infra left up — 'docker compose down' to stop it"; exit 0;;
  -h|--help) grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
  *) die "unknown arg: $a (try --help)";;
esac; done

cleanup(){ if [ "$KEEP_BG" = 1 ]; then return 0; fi; for pid in "${STARTED_PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

# ── preconditions ─────────────────────────────────────────────────────────────
command -v node >/dev/null || die "Node.js not found (need ≥20)"
command -v npm  >/dev/null || die "npm not found"
if [ "$DO_INFRA" = 1 ]; then command -v docker >/dev/null || die "docker not found (needed for infra; or pass --desktop-only)"; fi

# ── deps ──────────────────────────────────────────────────────────────────────
[ -d node_modules ] || { log "installing dependencies (first run — a few minutes) ..."; npm install; }

# ── .env + SECRET_ENCRYPTION_KEY (regenerate UNLESS it base64-decodes to 32 bytes) ──
# The API requires a 32-byte key (crypto.module.ts); an empty/placeholder/garbage
# value must be replaced, not just "any non-empty string". Node does the check so
# the logic is identical + CRLF-safe on every platform.
[ -f .env ] || { log "creating .env from .env.example"; cp .env.example .env; }
log "checking SECRET_ENCRYPTION_KEY ..."
node -e 'const fs=require("fs");let s=fs.readFileSync(".env","utf8");const m=s.match(/^SECRET_ENCRYPTION_KEY=(.*)$/m);let v=m?m[1].trim():"";let ok=false;try{ok=v.length>0&&Buffer.from(v,"base64").length===32}catch(e){}if(!ok){const k=require("crypto").randomBytes(32).toString("base64");s=m?s.replace(/^SECRET_ENCRYPTION_KEY=.*$/m,"SECRET_ENCRYPTION_KEY="+k):s.replace(/\s*$/,"")+"\nSECRET_ENCRYPTION_KEY="+k+"\n";fs.writeFileSync(".env",s);console.log("  generated a new 32-byte SECRET_ENCRYPTION_KEY");}else{console.log("  SECRET_ENCRYPTION_KEY ok");}'

# ── infra ─────────────────────────────────────────────────────────────────────
if [ "$DO_INFRA" = 1 ]; then
  if port_open 5432 && port_open 6379 && port_open 9000; then
    log "infra already up (5432/6379/9000) — skipping docker compose"
  else
    log "starting infra (Postgres/Redis/MinIO) ..."
    compose up -d --wait 2>/dev/null || { compose up -d; wait_port 5432 Postgres 90; }
  fi
fi

# ── database ──────────────────────────────────────────────────────────────────
if [ "$DO_DB" = 1 ]; then
  if [ "$RESET" = 1 ]; then log "resetting DB (drop + migrate + seed) ..."; npm run db:reset; DO_MODEL=1
  else
    log "applying migrations ..."
    if ! npm run db:migrate; then
      warn "db:migrate failed. If this is P3018 / a failed migration on a stale dev DB,"
      warn "reset it:   ./scripts/run-desktop.sh --reset      (or: docker compose down -v)"
      die "migrate failed — see the hint above"
    fi
    log "seeding demo data ..."; npm run db:seed || warn "db:seed reported an issue (usually: already seeded) — continuing"
  fi
fi

# ── API (:3000) ───────────────────────────────────────────────────────────────
if [ "$DO_API" = 1 ]; then
  if port_open 3000; then log "API already up on :3000 — skipping"
  else start_bg api "npm run dev:api" "$RUN_DIR/api.log"; wait_port 3000 API 120; fi
fi

# ── sample model (so the viewport isn't empty) ────────────────────────────────
if [ "$DO_MODEL" = 1 ]; then
  log "loading sample building (FZK-Haus) — needs internet on first run ..."
  npm run load-sample-model || warn "load-sample-model failed — viewer may be empty (re-run later: npm run load-sample-model)"
fi

# ── web (:8081 — required for the desktop's browser PKCE sign-in) ──────────────
if [ "$DO_WEB" = 1 ]; then
  if port_open 8081; then log "web already up on :8081 — skipping"
  else start_bg web "npm run dev:web" "$RUN_DIR/web.log"; wait_port 8081 web 120; fi
fi

# ── desktop (foreground GUI) ──────────────────────────────────────────────────
if [ "$DO_DESKTOP" = 1 ]; then
  [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] || warn "no DISPLAY/WAYLAND_DISPLAY — the Electron window needs a display (WSLg/native X/Wayland). On a headless shell it will fail."
  if [ "$(id -u)" = 0 ]; then warn "running as root — if Electron exits with a sandbox error, run as a non-root user (or use a packaged build)."; fi
  echo
  c '1;32' "── Sign in: ${SEED_EMAIL:-owner@acme.test} / ${SEED_PASSWORD:-devpassword123} ─────────"
  c '1;32' "   Verify in the 3D viewer (open Main Building):"
  c '0'    "     1) NO-FREEZE  — spinner keeps animating through the parse (frozen spinner = worker fell back to main thread)"
  c '0'    "     2) PICKING    — click an element → Inspector populates"
  c '0'    "     3) BCF        — Issues panel → a viewpoint restores camera + visibility"
  echo
  log "launching desktop (dev:desktop) — close the window or Ctrl-C to stop everything this script started"
  npm run dev:desktop
else
  log "backend is up: API http://localhost:3000  ·  web http://localhost:8081"
  log "stop it later with:  $0 --stop   (infra: 'docker compose down')"
fi
