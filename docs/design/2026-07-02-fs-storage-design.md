# FS storage backend — pluggable object storage (S3 / filesystem)

- **Date:** 2026-07-02
- **Status:** Approved (design) — implementation pending
- **Related:** [[local-first architecture direction]] (`docs/design/2026-06-30-local-first-architecture-direction.md`), the Redis-optional seam (same facade→backend shape).

## Context & problem

NodeScope stores blobs (IFC building models, BCF viewpoint snapshots) in S3-compatible
object storage — MinIO in dev/test/self-host. The single seam is `StorageService`
(`apps/api/src/storage/`), which is hard-wired to an injected `S3Client`.

For the **local-first / on-prem appliance** this is a liability:

- `StorageModule.onModuleInit` calls `ensureBucket()`, which rethrows if storage is
  unreachable — so **the API cannot boot without a running MinIO/S3**.
- `deploy/docker-compose.prod.yml` ships **no** object-storage service and sets no
  `STORAGE_*` — the appliance can't actually boot for storage. (The 3D-demo compose had
  to bundle MinIO purely as a workaround.)

A small single-site appliance shouldn't need to run and operate an object store just to
keep a few files. It should be able to write blobs to a **local directory** on a mounted
volume — no extra service, data stays on the box.

## Goals

1. A **filesystem storage backend** so the appliance runs with blobs on local disk, no
   MinIO/S3.
2. Keep S3 as a **first-class, default** backend — zero regression for dev/test and any
   S3/MinIO deployment.
3. Selectable by config; the API boots correctly under either backend.
4. A **migration tool** to copy blobs between backends in either direction (S3↔FS).
5. Remove the `prisma/seed.ts` S3 duplication (it must respect the selected backend).

## Non-goals

- No presigned URLs / browser-direct storage access (all blob access already streams
  through authed API routes with DB-sourced `Content-Length` — the FS backend needs no
  browser plumbing, and we keep it that way).
- No multi-node shared filesystem semantics. FS mode is for single-node; multi-node keeps
  using S3. (Parallel to Redis-optional: in-memory/FS = single-node, real service =
  multi-node.)
- No change to key layout, consumer APIs, or the export-data-isolation rules.

## Decisions

- **`STORAGE_DRIVER` defaults to `s3`.** FS is explicit opt-in (`STORAGE_DRIVER=fs`), so
  existing behavior is unchanged. (User decision.)
- **Ship a migration tool**, both directions. (User decision.)
- **Migration enumerates from the source backend** (list all objects), not from the DB —
  complete (catches every blob) and decoupled from the schema. (User decision.)
- **Abstraction = delegating backend**, not abstract-class subclasses — keeps the pure
  `buildVersionKey` on `StorageService` and leaves every consumer + test untouched.

## Architecture

Introduce a `StorageBackend` interface for the blob operations. `StorageService` remains
the consumer-facing seam: it keeps the pure key builder and delegates blob ops to an
injected backend.

```
consumers ──inject──> StorageService (unchanged API)
                          │  buildVersionKey()  ← pure, stays here
                          └─delegate→ StorageBackend  ← interface
                                        ├── S3StorageBackend   (@aws-sdk/client-s3)
                                        └── FsStorageBackend    (node:fs)
                          chosen by createStorageBackend(config) via STORAGE_DRIVER
```

### `StorageBackend` interface (`apps/api/src/storage/storage-backend.ts`)

```ts
import type { Readable } from 'node:stream';

export interface StorageBackend {
  /** S3: create bucket if missing; FS: mkdir -p the root. Idempotent. */
  ensureReady(): Promise<void>;
  put(key: string, body: Readable, contentType: string): Promise<void>;
  /** Resolves to a readable stream; rejects if the key is absent (matches S3). */
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** All keys currently stored (migration only). S3-key shape: forward-slash paths. */
  list(): Promise<string[]>;
}
```

### `S3StorageBackend` (`storage-backend.s3.ts`)

Today's `StorageService` S3 logic lifted verbatim: `CreateBucketCommand` (ensureReady),
`Upload` (put), `GetObjectCommand` (get), `DeleteObjectCommand` (delete),
`HeadObjectCommand` (exists), plus `list()` via paginated `ListObjectsV2Command`.
Constructed with an `S3Client` + bucket name.

### `FsStorageBackend` (`storage-backend.fs.ts`)

Root-directory storage. Constructed with an absolute root path.

- **`keyToPath(key)` — path safety first.** Reject keys that are absolute, contain a `\0`,
  or whose `/`-split segments include `..`, `.`, or empty. Resolve under root and assert
  the result stays within `root + path.sep`. (Keys are server-generated, but never trust.)
- **`put`:** `mkdir -p` the parent dir; write the stream to `<path>.<rand>.tmp`, then
  `rename` to the final path — **atomic**, so readers never see a partial/torn file, and a
  crash mid-write leaves only a stray temp (cleaned on error). `contentType` is ignored
  (FS has no metadata store; GET's `Content-Type` is set by the route from the DB, never
  from storage — so nothing is lost).
- **`get`:** if the file is absent, reject with an `ENOENT`-coded error (parity with S3
  throwing on a missing key, so callers' existing try/catch behavior is unchanged); else
  `createReadStream`.
- **`delete`:** `unlink`, swallow `ENOENT`. **`exists`:** `stat` → boolean.
- **`list`:** recursive walk of the root; return keys relative to root, normalized to
  forward slashes (so they match S3-key shape).

### `createStorageBackend(config)` (`storage-backend.factory.ts`)

Nest-independent factory: returns `FsStorageBackend` when `config.driver === 'fs'`, else
`S3StorageBackend`. Shared by `StorageModule`, `prisma/seed.ts`, and the migration script,
so backend selection lives in exactly one place.

### `StorageService` (delegation)

Keeps `buildVersionKey` (pure). Constructor takes a `StorageBackend`. The four consumer
methods delegate: `putObjectStream → backend.put`, `getObjectStream → backend.get`,
`deleteObject → backend.delete`, `objectExists → backend.exists`. **Method names and
signatures are unchanged, so no consumer or consumer-test changes.**

### `StorageModule`

Provide `StorageService` via a factory that builds `createStorageBackend(storageConfig())`.
`onModuleInit` → `backend.ensureReady()`.

## Config (`apps/api/src/common/config/storage.config.ts`)

Extend the existing helper:

```ts
export const storageConfig = () => ({
  driver: (process.env.STORAGE_DRIVER ?? 's3') as 's3' | 'fs',
  fsRoot: process.env.STORAGE_FS_ROOT ?? path.resolve(process.cwd(), 'var/storage'),
  // existing S3 fields unchanged:
  endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle: true,
});
```

`.env.example` documents `STORAGE_DRIVER=s3|fs` and `STORAGE_FS_ROOT` (used only in fs mode).

## Seed (`prisma/seed.ts`)

Replace the inline `S3Client` + `Upload` with `createStorageBackend(storageConfig())`:
`ensureReady()` then `put(key, Readable.from(placeholderIfc), 'application/octet-stream')`.
The seed now respects `STORAGE_DRIVER`, and the duplicated S3 code is gone.

## Migration tool (`scripts/migrate-storage.mjs`)

```
node scripts/migrate-storage.mjs --from s3 --to fs [--dry-run]
```

Constructs the source + dest backends **explicitly by name** per `--from`/`--to`
(`S3StorageBackend` / `FsStorageBackend`), bypassing the `STORAGE_DRIVER` selection — a
migration talks to two backends at once, unlike the app's single `StorageService`, so both
the S3 env (`STORAGE_*`) and `STORAGE_FS_ROOT` must be set for the run. `list()`s the
source; for each key: if `dest.exists(key)` at matching byte size → skip; else stream
`source.get(key) → dest.put(key)` and verify the written size. Prints copied / skipped /
failed counts; `--dry-run` reports the plan without writing. Works either direction.

## Deploy

FS mode removes the object-store dependency:

- Demo/appliance: set `STORAGE_DRIVER=fs`, `STORAGE_FS_ROOT=/data/storage`, mount a volume
  at `/data/storage`, and **drop the MinIO service** from `docker-compose.demo.yml` +
  `.env.demo`.
- **Volume writability:** the API container runs as user `node`. The `Dockerfile.api`
  pre-creates `/data/storage` owned by `node` so a bind/named volume mounted there is
  writable by the process (named volumes otherwise inherit root ownership).

## Error handling

- Missing-key `get` throws in both backends → unchanged caller behavior (a missing blob is
  a should-never-happen server error, since the DB tracks every key).
- `exists` never throws (S3 catches; FS treats `stat` failure as `false`).
- FS `put` is atomic; a mid-write failure cleans the temp file and rejects.
- Path-traversal attempts reject with a clear error before any fs call.

## Testing (TDD)

- **`FsStorageBackend` unit** (real tmp dir): put→get round-trip; get-missing rejects;
  delete idempotent (missing ok); exists true/false; **path-traversal rejection**;
  atomic-write (a reader during a write never sees partial bytes); `list` returns
  normalized keys.
- **Factory** selects fs vs s3 by `driver`.
- **e2e:** app boots with `STORAGE_DRIVER=fs`; IFC upload → activate → download
  round-trips through the FS backend (mirrors the no-Redis boot e2e). Existing S3/MinIO
  e2e stays green (regression).
- **Migration:** unit (fs→fs copy, skip-existing at matching size, `--dry-run` writes
  nothing) + a small integration copying a seeded blob between two roots.

## Files

**New:** `storage/storage-backend.ts`, `storage/storage-backend.s3.ts`,
`storage/storage-backend.fs.ts`, `storage/storage-backend.factory.ts`,
`scripts/migrate-storage.mjs`, and their tests.

**Modified:** `storage/storage.service.ts` (delegate), `storage/storage.module.ts`
(factory + `ensureReady`), `common/config/storage.config.ts` (driver + fsRoot),
`prisma/seed.ts` (use factory), `.env.example` (docs), `deploy/Dockerfile.api`
(pre-create `/data/storage`), `deploy/docker-compose.demo.yml` + `deploy/.env.demo`
(fs mode, drop MinIO).

## Back-compat & rollout

`STORAGE_DRIVER` defaults to `s3`, so nothing changes for existing dev/test/deploys until
they opt in. Switching an existing S3 deployment to FS is: run the migration tool
(`--from s3 --to fs`), then set `STORAGE_DRIVER=fs`.
