# Encrypted off-site backup

**Date:** 2026-07-05
**Status:** approved (brainstorm) — ready for implementation planning
**Type:** implementation spec (local-first "required change" #5)
**Parent:** `docs/design/2026-06-30-local-first-architecture-direction.md` (required change #5:
"Optional client-side-encrypted DB backup to S3-compatible storage… Backups are network data
leaving the building, so encryption is mandatory — consistent with the sovereignty rule.")
**Builds on:** appliance-packaging Phase 2 (`nodescope.sh backup` produces the bundle this
encrypts + uploads). This spec's branch `feat/offsite-backup` is **stacked on
`feat/appliance-packaging-phase2`**.

## Context

The appliance now takes **local** backups (Phase 2): a bundle directory
`nodescope-<ts>/{db.sql.gz, blobs.tar.gz, manifest.txt}`, pruned on-box. Local backups don't
survive the building — fire, theft, ransomware, or hardware death takes the appliance *and* its
backups. This spec adds an **optional, opt-in** off-site copy.

Because an off-site backup is network data leaving the building, the sovereignty rule makes
**client-side encryption mandatory**: the off-site provider must only ever see ciphertext. We go
one step further than the umbrella doc's minimum — the appliance holds only a **public** key and
can *encrypt but not decrypt* its own off-site backups (the private key is a recovery key kept
off-box), so even a compromised-but-running appliance can't read them.

## Decisions (settled in brainstorming)

- **Implementation = a node tool** in `apps/api/src/offsite/` (TypeScript, compiled into the API
  image like `migrate-storage.ts`), invoked by `nodescope.sh` via
  `docker compose run … api node dist/offsite/cli.js …`. Reuses the API image's node + deps; no
  host-side node needed. Chosen over `age`+`rclone` (two new binaries, un-testable in the dev
  sandbox) and `openssl`+`rclone` (no authenticated encryption from the CLI). The decisive factor
  is that the DR-critical encrypt→upload→download→decrypt round-trip is fully **testable
  in-sandbox** against MinIO + node.
- **Encryption = public-key hybrid sealed-box** (the construction `age` uses internally), via
  **`libsodium-wrappers`** (audited primitives, pure-wasm — no native build; a new apps/api dep).
  Chosen over hand-composed node-crypto ECIES to avoid rolling our own crypto.
- **Transport = S3-compatible** via `@aws-sdk/client-s3` + `@aws-sdk/lib-storage` (streaming
  multipart), reusing the existing storage backend's endpoint/`forcePathStyle` pattern. A
  **separate** `OFFSITE_S3_*` config — off-site is a distinct target from the app's primary
  storage. (S3-compatible covers the stated targets R2/B2/S3/Wasabi/MinIO; rclone's other
  backends are out of scope.)
- **Scope of what ships = the full bundle** (DB + blobs) by default; `OFFSITE_INCLUDE_BLOBS=false`
  ships DB-only for cost-sensitive sites (blob models dominate size/egress).
- **Schedule = chained** onto the Phase-2 backup timer: after a successful local `backup`, push
  the newest bundle off-site *if configured*.

## Goals / non-goals

**Goals**
- One `offsite-keygen` + a few `.env` values turns on encrypted off-site backup; the daily backup
  then mirrors off-site automatically.
- The off-site provider only ever holds ciphertext; the appliance cannot decrypt its own off-site
  backups.
- A clear disaster-recovery path: on a fresh box, supply the off-box private key and restore.

**Non-goals**
- Continuous / WAL / point-in-time backup (this ships whole bundles on the backup cadence —
  Litestream/pgBackRest-style streaming is a separate future capability).
- Non-S3 remotes (SFTP, GDrive, …) — S3-compatible only.
- Key rotation / re-encryption of old backups (future; the format is versioned to allow it).
- Provisioning the off-site bucket/account (operator's job; we document requirements).
- Changing the local backup format or the Phase-2 backup/restore flow.

---

## Components

### A. Crypto — `apps/api/src/offsite/crypto.ts`

Public-key encryption of a possibly-large bundle uses a **hybrid sealed-box**:

- **Encrypt (`sealStream(recipientPublicKey, input: Readable): Readable`):**
  1. Generate a random 32-byte **data key** (`sodium.crypto_secretstream_xchacha20poly1305_keygen`).
  2. Stream the input through `crypto_secretstream_xchacha20poly1305` in fixed-size chunks
     (e.g. 64 KiB), each an authenticated AEAD frame; the final chunk carries the `FINAL` tag.
  3. **Seal the data key** to the recipient with `crypto_box_seal(dataKey, recipientPublicKey)`
     (anonymous sealed box — no sender identity, encrypt-only).
  4. Output framing: `MAGIC("NSOB1") ‖ u16(sealedKeyLen) ‖ sealedKey ‖ streamHeader ‖ frames…`,
     where each frame is `u32(len) ‖ ciphertext`.
- **Decrypt (`unsealStream(publicKey, privateKey, input: Readable): Readable`):** parse the
  header, `crypto_box_seal_open(sealedKey, publicKey, privateKey)` → data key, init the
  secretstream with `streamHeader`, decrypt each frame; a bad tag/truncation throws (tamper/
  corruption detected). Requires the private key.
- **Keys:** `crypto_box_keypair()` → `{ publicKey, privateKey }` (X25519), base64-encoded.
- `libsodium-wrappers` requires `await sodium.ready` before use.

**Interface:** `sealStream`, `unsealStream`, `generateKeypair()`, plus `MAGIC`/version constant.
No S3, no filesystem — pure stream transforms, so it unit-tests without a network.

### B. S3-compatible transport — `apps/api/src/offsite/s3.ts`

A thin client over `@aws-sdk/client-s3` + `@aws-sdk/lib-storage`, mirroring
`storage-backend.s3.ts`'s construction (`endpoint`, `region`, `forcePathStyle: true`,
credentials):

- `putStream(key, body: Readable): Promise<void>` — `lib-storage` `Upload` (multipart, streams
  arbitrarily large ciphertext without buffering).
- `getStream(key): Promise<Readable>`.
- `list(prefix): Promise<string[]>` (keys, sorted).
- `del(key): Promise<void>`.
- Config from `OffsiteConfig` (component F). Reads the **`OFFSITE_S3_*`** env, distinct from the
  app's `STORAGE_*`.

### C. CLI + packing — `apps/api/src/offsite/cli.ts`

Argv dispatcher (like `migrate-storage.ts`), run as `node dist/offsite/cli.js <cmd>`:

- **`push <bundle-dir>`:**
  1. Pack the bundle into a single tar stream by spawning `tar` (present in the API image — the
     same binary Phase-2's blob step uses): `tar -c -C <bundle-dir> manifest.txt db.sql.gz`
     (+ `blobs.tar.gz` unless `OFFSITE_INCLUDE_BLOBS=false`), streaming its stdout. `pull`
     reverses it with `tar -x -C <dest-dir>`. No new tar dependency.
  2. `sealStream(pubkey, tarStream)` → ciphertext stream.
  3. `putStream("<prefix>/<bundle-name>.nsob", ciphertext)`.
  4. Prune remote to the newest `OFFSITE_KEEP` (`list` → `del` the oldest).
  Prints the remote key on success.
- **`pull <name> <dest-dir>`:** `getStream` → `unsealStream(pub, priv)` → untar into `<dest-dir>`
  as a bundle directory. Requires the private key (`--identity <file>` or `OFFSITE_IDENTITY`).
- **`list`:** print remote backup names (newest last) + sizes.

Fail-closed: `push` validates the bundle has `db.sql.gz`+`manifest.txt` and that a pubkey + S3
config are present before uploading; a failed upload does not leave a partial remote object
believed-complete (multipart abort on error).

### D. `nodescope.sh` wrappers (host-side ops)

Each shells into the API container (`compose run --rm --no-deps --entrypoint node api
dist/offsite/cli.js …`) with the bundle dir mounted + `OFFSITE_*` env passed:

- **`offsite-keygen`:** generate a keypair; write the **public** key into `deploy/.env`
  (`OFFSITE_BACKUP_PUBKEY`) and the **private** key to `deploy/offsite-identity.key` (chmod 600,
  gitignored). Then print a **loud, unmissable warning**: *this file is your only recovery key —
  copy it somewhere safe OFF this machine (password manager / another site), then delete the
  on-box copy (`rm deploy/offsite-identity.key`) so the appliance keeps only the public key
  (encrypt-only). Without this key, off-site backups are unrecoverable.* Re-running keygen refuses
  to overwrite an existing `OFFSITE_BACKUP_PUBKEY` without `--force` (regenerating the key orphans
  every existing off-site backup).
- **`offsite-push [bundle-dir]`** — default: newest local bundle (`latest_bundle`). No-ops with a
  clear message + exit 0 if `OFFSITE_BACKUP_PUBKEY`/S3 config is unset (so the chained timer step
  is safe when off-site isn't configured).
- **`offsite-list`.**
- **`offsite-pull <name> [dest-dir] --identity <file>`** — download+decrypt to a local bundle dir.
- **`offsite-restore <name> --identity <file>`** — `offsite-pull` then `restore` (the Phase-2
  command). Requires the operator to supply the off-box identity at recovery time.

Usage lines added; `usage()` is already range-independent (Phase 2).

### E. Scheduling — chain onto the backup timer

The Phase-2 `deploy/nodescope-backup.service` gains a second step so a scheduled run mirrors
off-site after a successful local backup:

```ini
ExecStart=__DEPLOY_DIR__/nodescope.sh backup
ExecStart=__DEPLOY_DIR__/nodescope.sh offsite-push
```

`offsite-push` (with no bundle arg) targets the newest bundle and no-ops when off-site is
unconfigured, so this is safe with or without off-site enabled. If off-site *is* configured and a
push genuinely fails (provider down), the unit fails → visible in `systemctl`/journald — but the
local backup (a prior, already-completed `ExecStart`) is untouched. `update`'s pre-update backup
calls `cmd_backup` directly (not the timer), so it stays local-only.

### F. Config + docs

`OffsiteConfig` (read in `cli.ts`) + `deploy/.env.example` additions:

| Var | Meaning | Default |
|---|---|---|
| `OFFSITE_BACKUP_PUBKEY` | recipient public key (base64); off-site is **off** when empty | (empty) |
| `OFFSITE_S3_ENDPOINT` | S3-compatible endpoint (e.g. R2/B2/S3 URL) | (empty) |
| `OFFSITE_S3_REGION` | region | `auto` |
| `OFFSITE_S3_BUCKET` | bucket | (empty) |
| `OFFSITE_S3_ACCESS_KEY` / `OFFSITE_S3_SECRET_KEY` | credentials | (empty) |
| `OFFSITE_S3_PREFIX` | key prefix | `nodescope` |
| `OFFSITE_KEEP` | remote bundles to retain | `7` |
| `OFFSITE_INCLUDE_BLOBS` | ship blobs (models) too | `true` |
| `OFFSITE_IDENTITY` | private-key file path (set only at restore time) | (unset) |

`deploy/README.md` gains an **"Off-site backup"** section: setup (`offsite-keygen` + the
key-safety warning), how the daily timer mirrors off-site, and a **disaster-recovery runbook**:
provision a fresh appliance (`install`), bring the off-box identity file, then
`offsite-list` → `offsite-restore <name> --identity <file>`.

### G. Testing

**jest (apps/api, in-sandbox — the DR-critical paths run locally):**
- `crypto.ts`: seal→unseal **round-trip** returns the exact input; **tamper detection** (flip one
  ciphertext byte → unseal throws); **wrong key** (unseal with a different identity → throws);
  large input spanning many chunks.
- `s3.ts`: put/get/list/del against **MinIO** (reuse the existing storage-test MinIO harness).
- `cli.ts`: a **full `push → list → pull → decrypt` round-trip against MinIO** with a real keypair
  and a fixture bundle; assert the pulled bundle bytes equal the original and the manifest
  survives; `OFFSITE_INCLUDE_BLOBS=false` omits blobs; retention prunes to `OFFSITE_KEEP`; a
  wrong identity fails the pull.
- **Negative:** `push` no-ops (exit 0) when unconfigured; `push` fails closed on a bundle missing
  `db.sql.gz`.

**shell (in-sandbox):** `shellcheck deploy/nodescope.sh`; arg-guard tests for the new wrappers
(missing `--identity` on pull → clear error).

**Optional CI:** a MinIO-backed off-site round-trip step in `deploy-validate.yml` (the jest tests
already cover it; CI adds the containerized end-to-end).

---

## Threat model (why this shape)

- **Provider sees plaintext?** No — everything is sealed client-side before upload; the bucket
  holds only `NSOB1` ciphertext.
- **Appliance stolen/compromised while running?** Once the operator has moved the private key
  off-box (as `offsite-keygen` instructs), the box holds only the **public** key, so an attacker
  can't decrypt existing off-site backups. (They can read the *live* DB — a bigger prize — but
  that's outside off-site backup's remit.)
- **Building destroyed?** Restore on a new box using the off-box **private** key — the standard DR
  path.
- **Lost private key?** Off-site backups become unrecoverable — hence the loud `offsite-keygen`
  warning and the recovery-key framing. This is inherent to client-side encryption and is the
  correct failure mode (better than a provider that can read your data).
- **Off-site credentials leaked?** Attacker can delete/overwrite ciphertext (DoS/tamper) but not
  read plaintext; tampering is caught on restore by the AEAD tags.

## File inventory

**Added**
- `apps/api/src/offsite/crypto.ts` (+ `crypto.spec.ts`) — hybrid sealed-box. *(A)*
- `apps/api/src/offsite/s3.ts` (+ `s3.spec.ts`) — S3-compatible transport. *(B)*
- `apps/api/src/offsite/cli.ts` (+ `cli.spec.ts`) — push/pull/list + packing. *(C)*
- `apps/api/src/offsite/config.ts` — `OffsiteConfig` env reader. *(F)*

**Modified**
- `apps/api/package.json` — add `libsodium-wrappers` (+ `@types/libsodium-wrappers`). *(A)*
- `deploy/nodescope.sh` — `offsite-keygen`/`push`/`list`/`pull`/`restore` wrappers + usage. *(D)*
- `deploy/nodescope-backup.service` — second `ExecStart` (chained off-site push). *(E)*
- `deploy/.env.example` — `OFFSITE_*` block. *(F)*
- `deploy/README.md` — off-site setup + DR runbook. *(F)*
- `.gitignore` — `deploy/offsite-identity.key` (never commit the recovery key). *(D)*
- (optional) `.github/workflows/deploy-validate.yml` — MinIO off-site round-trip. *(G)*

## Success criteria

1. `offsite-keygen` produces a keypair, stores the public key on the box, and makes the private
   key's recovery role unmissable.
2. With `OFFSITE_*` set, `offsite-push` seals the newest bundle and uploads only ciphertext to the
   S3-compatible target, pruning to `OFFSITE_KEEP`; the daily timer does this automatically.
3. On a fresh box with the off-box identity, `offsite-restore <name>` recovers a working stack
   (DB + models), proven by an in-sandbox `push→pull→decrypt` round-trip whose output bytes equal
   the original bundle.
4. Tampered or wrong-key ciphertext fails restore loudly (AEAD), never silently.
5. When off-site is unconfigured, the chained timer step no-ops and the local backup is unaffected.
