# Appliance packaging: turnkey on-prem site server

**Date:** 2026-07-04
**Status:** approved (brainstorm) — ready for implementation planning
**Type:** implementation spec (one of the local-first "required changes")
**Parent:** `docs/design/2026-06-30-local-first-architecture-direction.md` (required change #1:
"Bless on-prem deployment as primary… harden `docker-compose.prod.yml`; one-command
install; sane LAN defaults.")
**Depends on:** fs-storage backend (`docs/design/2026-07-02-fs-storage-design.md`, merged
`53c79a1`) and Redis-optional single-node mode (merged) — both are prerequisites this spec
finally *wires into the default deployment*.

## Context — why this is needed

The local-first direction makes the **per-site LAN server the source of truth**. That server
is supposed to "ship as a drop-in appliance." Today it does not:

1. **`deploy/docker-compose.prod.yml` cannot boot standalone.** It sets neither
   `SECRET_ENCRYPTION_KEY` (the crypto module throws without it —
   `apps/api/src/common/crypto/crypto.module.ts:10-14`) nor any storage config, and
   `STORAGE_DRIVER` defaults to `s3` pointing at a MinIO that prod doesn't run — so
   `StorageModule.onModuleInit`'s `ensureReady()` fails. Only the **demo overlay**
   (`docker-compose.demo.yml`) supplies both. The "prod" appliance is not actually deployable
   on its own. (This exact liability is called out in the fs-storage design, §Context.)
   `deploy-validate.yml` "boots prod" in CI only because Actions billing is unpaid, so the
   job never really runs — its `.env` has no `SECRET_ENCRYPTION_KEY` either and would fail.
2. **No one-command install.** Bring-up is a multi-step manual runbook: hand-generate three
   secrets with `openssl`, edit `PUBLIC_ORIGIN`, run a long `docker compose … --build`. There
   is no installer, no secret generation, no first-boot provisioning — in stark contrast to
   the polished per-OS *agent* installers (`apps/agent/scripts/install-*.{sh,ps1}`).
3. **Build-from-source on every box.** The compose `build:`s the images from the repo root,
   so each appliance needs the full source tree, a Node/native toolchain, and ~4 GB RAM for
   the Metro web export. Not appliance-grade.
4. **Origin is baked into the browser bundle.** `EXPO_PUBLIC_API_URL` is compiled into the web
   bundle at build time (5 call sites in `apps/web/lib`), so a LAN appliance reached at
   `http://<box-ip>:8080` would need a rebuild whenever its IP changes (DHCP). No LAN-first
   default exists.

This spec closes 1–4 and makes the site server a genuine turnkey appliance that installs in
one command, boots by default, is reachable over the LAN with no rebuild on IP change,
auto-starts, and can be backed up and updated.

## Decisions (settled in brainstorming)

- **Distribution = prebuilt images on GHCR.** CI publishes versioned
  `ghcr.io/ztur211/nodescope-{api,web}` images; the appliance compose *pulls* them. Public
  packages → customers pull with no auth. (Chosen over build-from-source and `docker save`
  tarball.)
- **Form factor = a Docker stack on any Linux host.** Runs on a mini-PC, a VM, or a container
  on the customer's existing server — the customer picks hardware. (A full VM/ISO image is a
  possible later spec, out of scope here.)
- **LAN origin = same-origin (relative) by default.** The web app defaults to
  `window.location.origin` when `EXPO_PUBLIC_API_URL` is unset, so the appliance works at any
  `http://<box-ip>:8080` with no rebuild on IP change.
- **TimescaleDB stays** (bundled via `timescale/timescaledb-ha:pg16`). The umbrella doc's
  "drop Timescale" note was reversed 2026-07-02; not revisited here.

## Goals / non-goals

**Goals**
- One command stands up a bootable, LAN-reachable, self-contained site server on any
  Linux+Docker host.
- The default deployment needs no repo, no build toolchain, and no cloud.
- The appliance survives reboots, can be backed up (DB **and** blobs) and restored, and can be
  updated to a new version with a documented rollback.

**Non-goals (each its own later spec, per the umbrella doc)**
- Encrypted **off-site** backup (#5) — this spec does *local* backup only.
- Out-of-band **alerting** (#6).
- **MSP** cross-site aggregation (#4).
- A full VM/OS **image / ISO**.
- Dropping TimescaleDB.
- Changing the **desktop** client (it keeps its own settings-configured API URL; only the
  browser web app gets the same-origin default).

## Scope — two phases

Landed incrementally (per the autonomous incremental-delivery preference). Each phase is
independently shippable.

- **Phase 1 — bootable, installable, LAN-reachable appliance:** components **A, B, C, D, H**.
- **Phase 2 — appliance lifecycle:** components **E, F, G** (systemd auto-start, local backup
  hardening, update/rollback).

---

## Phase 1

### A. Bootable appliance compose

Make `deploy/docker-compose.prod.yml` boot standalone as the appliance base, and split
building out into an overlay.

- **`api` service** gains first-class fs storage + crypto:
  - `STORAGE_DRIVER: ${STORAGE_DRIVER:-fs}`, `STORAGE_FS_ROOT: /data/storage`, and a
    `blobstore:/data/storage` volume mount (the Dockerfile already pre-creates
    `/data/storage` owned by `node`).
  - `SECRET_ENCRYPTION_KEY: ${SECRET_ENCRYPTION_KEY:?set SECRET_ENCRYPTION_KEY in deploy/.env}`.
  - **Relax `ANTHROPIC_API_KEY` to optional** (`${ANTHROPIC_API_KEY:-}`, was a required `:?`
    guard). An AI-optional / local-Ollama appliance must not be forced to hold a cloud key to
    boot. Verified the API tolerates this: the Anthropic SDK does **not** throw at construction
    with a missing key (the `ClaudeAdapter` DI factory runs at boot), so the app boots fine and
    only live AI calls fail until a key or `AI_PROVIDER=openai-compatible` is configured. No
    apps/api change needed — purely the compose guard.
- **Prebuilt images, not build:** `api` and `web` use
  `image: ghcr.io/ztur211/nodescope-{api,web}:${NODESCOPE_VERSION:-<pinned-release>}` and drop
  their `build:` blocks.
- **New `deploy/docker-compose.build.yml` overlay** carrying the `build:` blocks (context `..`,
  the two Dockerfiles) so CI and local dev can build/publish:
  `docker compose -f docker-compose.prod.yml -f docker-compose.build.yml build`. The overlay
  only *adds* `build:` — it keeps the same `image:` reference, so a local build tags the image
  compose already expects and `up` uses the locally-built image without touching a registry.
  This also resolves the bootstrap: before the first GHCR publish exists, dev and CI use the
  build overlay; `NODESCOPE_VERSION` defaults to the first published tag once C ships one.
- **`deploy/docker-compose.demo.yml` slims down** to just the `demo-seed` one-shot; it no longer
  needs to re-declare `SECRET_ENCRYPTION_KEY`/`STORAGE_*`/`blobstore` (now inherited from prod).
- **Version pinning:** `NODESCOPE_VERSION` documented in `.env.example`; also pin `cloudflared`
  off `:latest` to a digest/tag.

Result: `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d` boots a
complete single-node stack (db + api + web), no overlay required.

### B. Same-origin web API base

Remove the build-time origin bake for the same-origin appliance case.

- **New `apps/web/lib/api-base.ts`:**
  ```ts
  export function resolveApiBaseUrl(): string {
    // 1) explicit build-time override (dev, or a split-origin deploy)
    if (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_API_URL)
      return process.env.EXPO_PUBLIC_API_URL;
    // 2) browser: same origin we were served from (the LAN appliance case)
    if (typeof window !== 'undefined' && window.location?.origin)
      return window.location.origin;
    // 3) native / SSR / test fallback
    return 'http://localhost:3000';
  }
  ```
- **Replace the 5 duplicated resolutions** with `resolveApiBaseUrl()`:
  `lib/api.service.ts`, `lib/auth-client.ts`, `lib/websocket.service.ts`,
  `lib/browser-collector.service.ts`, `app/(auth)/login.tsx`.
- **`deploy/Dockerfile.web`:** change the `ARG EXPO_PUBLIC_API_URL` default from
  `http://localhost:3000` to **empty**, so the published appliance web image is origin-agnostic
  (empty is falsy → resolver falls through to `window.location.origin`). The build overlay/dev
  can still pass an explicit URL for a split-origin deploy.
- **Server side still needs an origin.** `FRONTEND_URL` (hard-thrown in `main.ts` for CORS) and
  `BETTER_AUTH_URL` must equal the browser origin, so the installer writes
  `PUBLIC_ORIGIN=http://<lan-ip>:<WEB_PORT>` into `.env` (component D). The win: this is
  **runtime** env on a **prebuilt** image, so changing it is a `.env` edit + `up -d` — never a
  rebuild.

### C. Prebuilt images + GHCR publish pipeline

- **New `.github/workflows/publish-images.yml`** (trigger: release tag `v*` + `workflow_dispatch`
  with a version input):
  - `docker buildx` build `api` (`deploy/Dockerfile.api`) and `web` (`deploy/Dockerfile.web`,
    `--build-arg EXPO_PUBLIC_API_URL=` empty) with context `..`.
  - Tag + push `ghcr.io/ztur211/nodescope-{api,web}:<version>` and `:latest`.
  - Auth with the workflow `GITHUB_TOKEN` (`packages: write`); publish the packages **public** so
    on-prem customers pull without credentials.
  - **Runs on the self-hosted runner** (`runs-on: [self-hosted, linux]`) because GitHub-hosted
    Actions billing is unpaid — see Assumptions (Docker+buildx on the runner).

### D. One-command installer — `deploy/nodescope.sh`

A single cohesive management script (subcommand dispatcher):

- **`install`** (the headline one command):
  1. **Preflight:** `docker` + `docker compose` plugin present; required host ports free
     (`WEB_PORT`, default 8080); warn on low free disk.
  2. **Secrets:** generate `POSTGRES_PASSWORD` (`openssl rand -base64 24`),
     `BETTER_AUTH_SECRET` (`openssl rand -base64 48`), `SECRET_ENCRYPTION_KEY`
     (`openssl rand -base64 32` → 32 bytes) into `deploy/.env` **idempotently** (never
     overwrite existing values — re-running is safe).
  3. **LAN origin:** auto-detect the primary LAN IP (`ip route get 1.1.1.1` / first non-loopback),
     accept `--origin <url>` / `--web-port <n>` overrides, write
     `PUBLIC_ORIGIN=http://<ip>:<WEB_PORT>`.
  4. **Bring up:** `docker compose -f docker-compose.prod.yml --env-file .env pull` then
     `up -d --wait` (waits on healthchecks).
  5. **Verify:** run `scripts/smoke.mjs <origin> <origin>` (9 checks: API health, health
     db+redis dependencies, unauth session, auth-enforced, CORS preflight, socket.io
     handshake, web root, web bundle, web catch-all).
  6. **Report:** print the LAN URL, the "create your first account" hint, and how to point the
     desktop app at `http://<ip>:<WEB_PORT>/api`.
- **`reconfigure`:** re-detect / change the origin or web port → rewrite `.env` → `up -d` (no
  rebuild — the payoff of A+B). Used when the LAN IP changes.
- **Lifecycle wrappers** (thin in Phase 1, fleshed out in Phase 2): `status`, `logs`,
  `backup`, `restore`, `update`.
- **Note:** cookie auth runs over plain HTTP on the LAN (same as today's `http://localhost`
  demo). HTTPS/hostname stays the optional remote-access path (Tailscale/Cloudflare, component H).

### H. Docs + CI validation

- **`deploy/README.md`** reframed around the **LAN-first appliance** as the primary path: the
  one-command quick start up front; Tailscale/Cloudflare Tunnel demoted to an optional "remote
  access" section; the DigitalOcean `deploy.yml` path demoted to "optional cloud."
- **`deploy/.env.example`** documents `NODESCOPE_VERSION`, `STORAGE_DRIVER=fs`,
  `SECRET_ENCRYPTION_KEY`, and that `PUBLIC_ORIGIN` is set automatically by the installer.
- **`.github/workflows/deploy-validate.yml`:** add `SECRET_ENCRYPTION_KEY` to the CI `.env`;
  build via the `-f docker-compose.build.yml` overlay (`up -d --build --wait`); keep the smoke
  test + backup-script check; move to `runs-on: [self-hosted, linux]` so it actually runs.

### Phase-1 testing

- **Unit (runs in this sandbox):** jest test for `resolveApiBaseUrl` covering all three branches
  (explicit env, browser `window.location.origin`, fallback). This is the only new runtime code.
- **Static (runs in this sandbox, no Docker daemon):**
  `docker compose … config` parse/interpolate validation of prod + build + demo overlays
  (catches missing/typo'd interpolation); `shellcheck` + `bash -n` on `nodescope.sh`.
- **Integration (self-hosted runner, has Docker):** `deploy-validate.yml` builds and boots the
  appliance and runs `smoke.mjs` — the real end-to-end proof.
- **Honesty note:** container runtime cannot be validated in this sandbox (no Docker); Phase-1
  correctness of the *running stack* rests on the self-hosted CI job.

---

## Phase 2 — appliance lifecycle

### E. systemd auto-start

- **`deploy/nodescope.service`** — a oneshot unit with `RemainAfterExit=yes`,
  `ExecStart=docker compose -f <abs>/docker-compose.prod.yml --env-file <abs>/.env up -d`,
  `ExecStop=… down`, `WantedBy=multi-user.target`. Container `restart: unless-stopped` already
  covers crash/daemon-restart; the unit ensures `up` after a clean `down` or reboot.
- `nodescope.sh install` offers to install + `systemctl enable --now` it (opt-in prompt / flag).

### F. Local backup hardening

- Extend the backup to capture **both** stores into one timestamped bundle:
  - Postgres via `pg_dump` (exists in `backup.sh`), **plus** the fs `blobstore` volume (IFC/BCF
    models) via a `tar` of `/data/storage` from a throwaway container mounting the volume.
  - Keep the empty-dump guard; add **retention** (keep last N, prune older).
- **Scheduling:** `nodescope.sh install` optionally installs a cron entry / systemd timer
  (opt-in).
- **`nodescope.sh restore <bundle>`:** stop `api` → restore the `pg_dump` into `db` → restore the
  blob tar into the `blobstore` volume → `up -d`. Documented + exercised in CI as far as Docker
  allows.
- **Consistency caveat** documented: DB and blob snapshots are taken back-to-back, not in a
  single transaction — acceptable for this data (blobs are immutable, content-addressed
  versions). Encrypted off-site backup remains spec #5.

### G. Update / rollback

- **`nodescope.sh update [version]`:** `backup` first (safety) → set `NODESCOPE_VERSION` in
  `.env` → `pull` → `up -d --wait` (migrate-on-boot rolls the schema forward via
  `prisma migrate deploy`) → `smoke.mjs`.
- **Rollback:** Prisma migrations are **forward-only** (no auto-down) — documented prominently.
  `nodescope.sh rollback` = restore the pre-update backup + re-pin the previous
  `NODESCOPE_VERSION` + `up -d`. `update` therefore always backs up first and prints the exact
  rollback command on completion.
- **Version pinning:** default `NODESCOPE_VERSION` to a concrete published tag (never `latest`)
  so a `docker compose pull` can't silently jump versions.

### Phase-2 testing

- `bash -n` / `shellcheck` on the new script paths and the systemd unit
  (`systemd-analyze verify`, best-effort).
- Self-hosted CI: extend `deploy-validate.yml` to exercise a backup → restore round-trip
  (dump + blob tar produced, restore re-imports, smoke still passes).

---

## File inventory

**Changed**
- `deploy/docker-compose.prod.yml` — fs storage + `SECRET_ENCRYPTION_KEY` + `blobstore` volume;
  `build:` → `image:` (GHCR); version pins. *(A)*
- `deploy/docker-compose.demo.yml` — slim to the seed one-shot. *(A)*
- `deploy/Dockerfile.web` — `EXPO_PUBLIC_API_URL` ARG default → empty. *(B)*
- `deploy/.env.example` — new/updated vars + docs. *(D/H)*
- `deploy/README.md` — LAN-first reframe. *(H)*
- `deploy/backup.sh` — grows blob-volume capture + retention; `nodescope.sh backup` wraps it
  (and cron/timer calls it directly). *(F)*
- `.github/workflows/deploy-validate.yml` — `SECRET_ENCRYPTION_KEY`, build overlay, self-hosted. *(H)*
- `apps/web/lib/{api.service,auth-client,websocket.service,browser-collector}.ts`,
  `apps/web/app/(auth)/login.tsx` — use `resolveApiBaseUrl()`. *(B)*

**Added**
- `deploy/docker-compose.build.yml` — build overlay. *(A)*
- `deploy/nodescope.sh` — installer + lifecycle. *(D/E/F/G)*
- `deploy/nodescope.service` — systemd unit. *(E)*
- `.github/workflows/publish-images.yml` — GHCR publish. *(C)*
- `apps/web/lib/api-base.ts` (+ `api-base.test.ts`) — same-origin resolver. *(B)*

## Assumptions, dependencies, risks

- **Self-hosted runner has Docker + buildx.** Both `publish-images.yml` and the moved
  `deploy-validate.yml` depend on it. If not, publishing/validation stall — *confirm with the
  user / on the runner host before Phase-1 CI changes land.* (This is the least
  in-sandbox-verifiable part of the spec.)
- **GHCR packages must be set public** (one-time, in the repo's package settings) so customers
  pull without auth. First publish creates them private by default.
- **No Docker in this sandbox** → the running stack is validated only on the self-hosted runner;
  local verification is `compose config` + shellcheck + the jest resolver test.
- **Cookie auth over plain HTTP on the LAN** works today for `http://localhost` (demo); the same
  applies to `http://<lan-ip>:8080`. HTTPS is the optional remote-access path, not required for
  LAN.
- **Forward-only migrations** make rollback a restore-from-backup operation, not a schema
  down-migration — surfaced in the `update` UX and docs.

## Success criteria

1. On a fresh Linux+Docker host, `./deploy/nodescope.sh install` brings up a working NodeScope
   reachable at `http://<lan-ip>:8080`, with `smoke.mjs` passing — no manual secret generation,
   no repo build, no overlay. *(Phase 1)*
2. Changing the box's IP and running `nodescope.sh reconfigure` restores access with no image
   rebuild. *(Phase 1)*
3. `deploy-validate.yml` builds + boots the appliance and passes smoke on the self-hosted runner.
   *(Phase 1)*
4. After a reboot the stack is back up automatically; `nodescope.sh backup` captures DB + blobs
   and `restore` round-trips; `nodescope.sh update` moves versions and prints a working rollback
   command. *(Phase 2)*
