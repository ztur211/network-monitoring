# FS Storage Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a filesystem storage backend so the local-first appliance stores blobs on local disk with no MinIO/S3, while S3 stays the default backend.

**Architecture:** Introduce a `StorageBackend` interface with `S3StorageBackend` and `FsStorageBackend` implementations, selected by a `createStorageBackend(config)` factory keyed on `STORAGE_DRIVER`. `StorageService` keeps the pure `buildVersionKey` and delegates blob ops to the injected backend, so consumers are unchanged. A `scripts/migrate-storage.mjs` copies blobs between backends either direction.

**Tech Stack:** NestJS, TypeScript, `@aws-sdk/client-s3`, `node:fs`, jest (ESM).

Spec: `docs/design/2026-07-02-fs-storage-design.md`.

## Global Constraints

- **TDD:** every implementation step is preceded by a failing test that you run and watch fail. Copied verbatim from the spec's testing section.
- **`STORAGE_DRIVER` default = `s3`.** FS is opt-in. No regression for existing dev/test/deploys.
- **No presigned URLs / no browser storage plumbing.** All blob access stays through authed API routes; `Content-Length` comes from the DB, never from storage.
- **Consumer API unchanged:** `StorageService` keeps method names `buildVersionKey`, `putObjectStream`, `getObjectStream`, `deleteObject`, `objectExists` with identical signatures.
- **jest unit test naming:** the unit config's `testRegex` matches specific suffixes; Task 1 adds a `storage/__tests__` branch so storage test files can be named naturally.
- **Run unit tests** from `apps/api` with: `NODE_OPTIONS="--experimental-vm-modules --no-warnings" npx jest --config jest.unit.config.ts <path>`.
- **Node built-ins** use the `node:` prefix (`node:fs`, `node:path`, `node:stream`).

---

### Task 1: Storage config (driver + fsRoot) + jest storage-test inclusion

**Files:**
- Modify: `apps/api/src/common/config/storage.config.ts`
- Modify: `apps/api/jest.unit.config.ts` (add a storage `testRegex` branch)
- Test: `apps/api/src/common/config/__tests__/storage.config.spec.ts`

**Interfaces:**
- Produces: `storageConfig()` now returns `{ driver: 's3' | 'fs'; fsRoot: string; endpoint; region; bucket; accessKeyId; secretAccessKey; forcePathStyle }`.

- [ ] **Step 1: Write the failing test** — `apps/api/src/common/config/__tests__/storage.config.spec.ts`

```ts
import path from 'node:path';
import { storageConfig } from '../storage.config';

describe('storageConfig', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('defaults driver to s3', () => {
    delete process.env.STORAGE_DRIVER;
    expect(storageConfig().driver).toBe('s3');
  });

  it('reads driver=fs when set', () => {
    process.env.STORAGE_DRIVER = 'fs';
    expect(storageConfig().driver).toBe('fs');
  });

  it('defaults fsRoot under cwd/var/storage and honours STORAGE_FS_ROOT', () => {
    delete process.env.STORAGE_FS_ROOT;
    expect(storageConfig().fsRoot).toBe(path.resolve(process.cwd(), 'var/storage'));
    process.env.STORAGE_FS_ROOT = '/data/storage';
    expect(storageConfig().fsRoot).toBe('/data/storage');
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `NODE_OPTIONS="--experimental-vm-modules --no-warnings" npx jest --config jest.unit.config.ts src/common/config/__tests__/storage.config.spec.ts`
Expected: FAIL — `storageConfig().driver` is undefined.

- [ ] **Step 3: Implement** — replace `apps/api/src/common/config/storage.config.ts`

```ts
import path from 'node:path';

/**
 * Object-storage config. `driver` selects the backend: `s3` (default; S3/MinIO)
 * or `fs` (local filesystem, single-node appliance). `forcePathStyle` is required
 * for MinIO. `fsRoot` is used only in fs mode.
 */
export const storageConfig = () => ({
  driver: (process.env.STORAGE_DRIVER ?? 's3') as 's3' | 'fs',
  fsRoot: process.env.STORAGE_FS_ROOT ?? path.resolve(process.cwd(), 'var/storage'),
  endpoint: process.env.STORAGE_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.STORAGE_REGION ?? 'us-east-1',
  bucket: process.env.STORAGE_BUCKET ?? 'nodescope',
  accessKeyId: process.env.STORAGE_ACCESS_KEY ?? 'minioadmin',
  secretAccessKey: process.env.STORAGE_SECRET_KEY ?? 'minioadmin',
  forcePathStyle: true,
});
```

- [ ] **Step 4: Add the storage `testRegex` branch** — in `apps/api/jest.unit.config.ts`, add one entry to the `testRegex` array (after the monitoring branch):

```ts
    // Storage: pure-logic + real-tmpdir backend tests (no external service).
    '.*/storage/__tests__/.*\\.spec\\.ts$',
```

- [ ] **Step 5: Run tests, watch pass**

Run: `NODE_OPTIONS="--experimental-vm-modules --no-warnings" npx jest --config jest.unit.config.ts src/common/config/__tests__/storage.config.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/common/config/storage.config.ts apps/api/src/common/config/__tests__/storage.config.spec.ts apps/api/jest.unit.config.ts
git commit -m "feat(storage): add STORAGE_DRIVER + STORAGE_FS_ROOT config"
```

---

### Task 2: `StorageBackend` interface + path-safety helper

**Files:**
- Create: `apps/api/src/storage/storage-backend.ts`
- Test: `apps/api/src/storage/__tests__/storage-backend.spec.ts`

**Interfaces:**
- Produces:
  - `interface StorageBackend { ensureReady(): Promise<void>; put(key: string, body: Readable, contentType: string): Promise<void>; get(key: string): Promise<Readable>; delete(key: string): Promise<void>; exists(key: string): Promise<boolean>; list(): Promise<string[]> }`
  - `resolveKeyPath(root: string, key: string): string` — throws `Error('INVALID_STORAGE_KEY')` on unsafe keys, else returns the absolute path under `root`.

- [ ] **Step 1: Write the failing test** — `apps/api/src/storage/__tests__/storage-backend.spec.ts`

```ts
import path from 'node:path';
import { resolveKeyPath } from '../storage-backend';

describe('resolveKeyPath', () => {
  const root = '/srv/storage';

  it('resolves a normal hierarchical key under root', () => {
    expect(resolveKeyPath(root, 'org/o1/building/b1/v1.ifc')).toBe(
      path.join(root, 'org/o1/building/b1/v1.ifc'),
    );
  });

  it.each([
    'org/../../etc/passwd',
    '../secret',
    '/absolute/key',
    'org/./x',
    'org//x',
    'a\0b',
  ])('rejects unsafe key %p', (key) => {
    expect(() => resolveKeyPath(root, key)).toThrow('INVALID_STORAGE_KEY');
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `NODE_OPTIONS="--experimental-vm-modules --no-warnings" npx jest --config jest.unit.config.ts src/storage/__tests__/storage-backend.spec.ts`
Expected: FAIL — cannot find `resolveKeyPath`.

- [ ] **Step 3: Implement** — `apps/api/src/storage/storage-backend.ts`

```ts
import path from 'node:path';
import type { Readable } from 'node:stream';

/** The blob operations behind StorageService. Implemented by S3 + FS backends. */
export interface StorageBackend {
  /** Idempotent: S3 creates the bucket; FS makes the root dir. */
  ensureReady(): Promise<void>;
  put(key: string, body: Readable, contentType: string): Promise<void>;
  /** Rejects if the key is absent (parity with S3). */
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Every stored key, forward-slash form (migration only). */
  list(): Promise<string[]>;
}

/**
 * Map a storage key to an absolute filesystem path under `root`, rejecting any key
 * that could escape the root. Keys are server-generated, but never trust input.
 */
export function resolveKeyPath(root: string, key: string): string {
  if (key.includes('\0') || path.isAbsolute(key)) throw new Error('INVALID_STORAGE_KEY');
  const segments = key.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error('INVALID_STORAGE_KEY');
  }
  const resolved = path.resolve(root, ...segments);
  const rootWithSep = path.resolve(root) + path.sep;
  if (!resolved.startsWith(rootWithSep)) throw new Error('INVALID_STORAGE_KEY');
  return resolved;
}
```

- [ ] **Step 4: Run tests, watch pass**

Run: `NODE_OPTIONS="--experimental-vm-modules --no-warnings" npx jest --config jest.unit.config.ts src/storage/__tests__/storage-backend.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/storage/storage-backend.ts apps/api/src/storage/__tests__/storage-backend.spec.ts
git commit -m "feat(storage): StorageBackend interface + path-safe key resolver"
```

---

### Task 3: `FsStorageBackend`

**Files:**
- Create: `apps/api/src/storage/storage-backend.fs.ts`
- Test: `apps/api/src/storage/__tests__/storage-backend.fs.spec.ts`

**Interfaces:**
- Consumes: `StorageBackend`, `resolveKeyPath` from Task 2.
- Produces: `class FsStorageBackend implements StorageBackend` with `constructor(root: string)`.

- [ ] **Step 1: Write the failing test** — `apps/api/src/storage/__tests__/storage-backend.fs.spec.ts`

```ts
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { FsStorageBackend } from '../storage-backend.fs';

async function drain(s: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

describe('FsStorageBackend', () => {
  let root: string;
  let fs: FsStorageBackend;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'nodescope-fs-'));
    fs = new FsStorageBackend(root);
    await fs.ensureReady();
  });

  it('put then get round-trips the bytes', async () => {
    await fs.put('org/o1/building/b1/v1.ifc', Readable.from(Buffer.from('hello')), 'application/octet-stream');
    expect((await drain(await fs.get('org/o1/building/b1/v1.ifc'))).toString()).toBe('hello');
  });

  it('put leaves no .tmp file behind at the key path (atomic)', async () => {
    await fs.put('a/b.bin', Readable.from(Buffer.from('x')), 'application/octet-stream');
    expect(existsSync(path.join(root, 'a/b.bin'))).toBe(true);
    expect(readdirSync(path.join(root, 'a')).some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('get rejects with ENOENT for a missing key', async () => {
    await expect(fs.get('nope/x.bin')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('delete is idempotent (missing key is ok)', async () => {
    await expect(fs.delete('nope/x.bin')).resolves.toBeUndefined();
    await fs.put('k.bin', Readable.from(Buffer.from('x')), 'application/octet-stream');
    await fs.delete('k.bin');
    expect(await fs.exists('k.bin')).toBe(false);
  });

  it('exists reflects presence', async () => {
    expect(await fs.exists('k.bin')).toBe(false);
    await fs.put('k.bin', Readable.from(Buffer.from('x')), 'application/octet-stream');
    expect(await fs.exists('k.bin')).toBe(true);
  });

  it('list returns forward-slash keys relative to root', async () => {
    await fs.put('org/o1/a.ifc', Readable.from(Buffer.from('1')), 'application/octet-stream');
    await fs.put('org/o1/bcf/t/s.png', Readable.from(Buffer.from('2')), 'image/png');
    expect((await fs.list()).sort()).toEqual(['org/o1/a.ifc', 'org/o1/bcf/t/s.png']);
  });

  it('rejects an unsafe key', async () => {
    await expect(fs.put('../escape', Readable.from(Buffer.from('x')), 'x')).rejects.toThrow('INVALID_STORAGE_KEY');
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `NODE_OPTIONS="--experimental-vm-modules --no-warnings" npx jest --config jest.unit.config.ts src/storage/__tests__/storage-backend.fs.spec.ts`
Expected: FAIL — cannot find `FsStorageBackend`.

- [ ] **Step 3: Implement** — `apps/api/src/storage/storage-backend.fs.ts`

```ts
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { StorageBackend, resolveKeyPath } from './storage-backend';

/** Local-filesystem blob storage rooted at a directory. Single-node only. */
export class FsStorageBackend implements StorageBackend {
  constructor(private readonly root: string) {}

  async ensureReady(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async put(key: string, body: Readable, _contentType: string): Promise<void> {
    const dest = resolveKeyPath(this.root, key);
    await mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await pipeline(body, createWriteStream(tmp));
      await rename(tmp, dest); // atomic within a filesystem
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
  }

  async get(key: string): Promise<Readable> {
    const src = resolveKeyPath(this.root, key);
    await access(src); // throws ENOENT if missing, before returning a stream
    return createReadStream(src);
  }

  async delete(key: string): Promise<void> {
    await rm(resolveKeyPath(this.root, key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(resolveKeyPath(this.root, key));
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(abs);
        else out.push(path.relative(this.root, abs).split(path.sep).join('/'));
      }
    };
    try {
      await walk(this.root);
    } catch {
      /* root may not exist yet → empty */
    }
    return out;
  }
}
```

- [ ] **Step 4: Run tests, watch pass**

Run: `NODE_OPTIONS="--experimental-vm-modules --no-warnings" npx jest --config jest.unit.config.ts src/storage/__tests__/storage-backend.fs.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/storage/storage-backend.fs.ts apps/api/src/storage/__tests__/storage-backend.fs.spec.ts
git commit -m "feat(storage): FsStorageBackend (atomic writes, path-safe, list)"
```

---

### Task 4: `S3StorageBackend`

**Files:**
- Create: `apps/api/src/storage/storage-backend.s3.ts`
- Test: `apps/api/src/storage/__tests__/storage-backend.s3.spec.ts`

**Interfaces:**
- Consumes: `StorageBackend` from Task 2.
- Produces: `class S3StorageBackend implements StorageBackend` with `constructor(s3: S3Client, bucket: string)`.

- [ ] **Step 1: Write the failing test** — `apps/api/src/storage/__tests__/storage-backend.s3.spec.ts`

```ts
import { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { S3StorageBackend } from '../storage-backend.s3';

describe('S3StorageBackend', () => {
  const send = jest.fn();
  const s3 = { send } as any;
  let backend: S3StorageBackend;

  beforeEach(() => {
    jest.clearAllMocks();
    backend = new S3StorageBackend(s3, 'nodescope');
  });

  it('ensureReady swallows BucketAlreadyOwnedByYou', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error(), { name: 'BucketAlreadyOwnedByYou' }));
    await expect(backend.ensureReady()).resolves.toBeUndefined();
    expect(send.mock.calls[0][0]).toBeInstanceOf(CreateBucketCommand);
  });

  it('get issues a GetObjectCommand and returns the Body stream', async () => {
    const body = Readable.from(Buffer.from('x'));
    send.mockResolvedValueOnce({ Body: body });
    expect(await backend.get('k')).toBe(body);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
  });

  it('exists is true/false from HeadObjectCommand', async () => {
    send.mockResolvedValueOnce({});
    expect(await backend.exists('k')).toBe(true);
    send.mockRejectedValueOnce(Object.assign(new Error(), { name: 'NotFound' }));
    expect(await backend.exists('k')).toBe(false);
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
  });

  it('delete issues a DeleteObjectCommand', async () => {
    send.mockResolvedValueOnce({});
    await backend.delete('k');
    expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('list paginates ListObjectsV2 and returns keys', async () => {
    send
      .mockResolvedValueOnce({ Contents: [{ Key: 'a' }, { Key: 'b' }], IsTruncated: true, NextContinuationToken: 't' })
      .mockResolvedValueOnce({ Contents: [{ Key: 'c' }], IsTruncated: false });
    expect(await backend.list()).toEqual(['a', 'b', 'c']);
    expect(send.mock.calls[0][0]).toBeInstanceOf(ListObjectsV2Command);
    expect(send.mock.calls[1][0].input.ContinuationToken).toBe('t');
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `NODE_OPTIONS="--experimental-vm-modules --no-warnings" npx jest --config jest.unit.config.ts src/storage/__tests__/storage-backend.s3.spec.ts`
Expected: FAIL — cannot find `S3StorageBackend`.

- [ ] **Step 3: Implement** — `apps/api/src/storage/storage-backend.s3.ts`

```ts
import type { Readable } from 'node:stream';
import {
  S3Client,
  CreateBucketCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { StorageBackend } from './storage-backend';

/** S3-compatible (MinIO) blob storage. The multi-node / cloud backend. */
export class S3StorageBackend implements StorageBackend {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async ensureReady(): Promise<void> {
    try {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (e: unknown) {
      const name = (e as { name?: string })?.name;
      if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw e;
    }
  }

  async put(key: string, body: Readable, contentType: string): Promise<void> {
    await new Upload({
      client: this.s3,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
    }).done();
  }

  async get(key: string): Promise<Readable> {
    const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return out.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const out = await this.s3.send(
        new ListObjectsV2Command({ Bucket: this.bucket, ContinuationToken: token }),
      );
      for (const o of out.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }
}
```

- [ ] **Step 4: Run tests, watch pass**

Run: `NODE_OPTIONS="--experimental-vm-modules --no-warnings" npx jest --config jest.unit.config.ts src/storage/__tests__/storage-backend.s3.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/storage/storage-backend.s3.ts apps/api/src/storage/__tests__/storage-backend.s3.spec.ts
git commit -m "feat(storage): S3StorageBackend (lifted S3 logic + list pagination)"
```

---

### Task 5: Factory + `StorageService` delegation + `StorageModule` wiring

**Files:**
- Create: `apps/api/src/storage/storage-backend.factory.ts`
- Modify: `apps/api/src/storage/storage.service.ts`
- Modify: `apps/api/src/storage/storage.module.ts`
- Test: `apps/api/src/storage/__tests__/storage-backend.factory.spec.ts`
- Modify test: `apps/api/src/storage/__tests__/storage.service.spec.ts`

**Interfaces:**
- Consumes: `S3StorageBackend`, `FsStorageBackend`, `StorageBackend`, `storageConfig()`.
- Produces:
  - `createStorageBackend(config: ReturnType<typeof storageConfig>): StorageBackend`
  - `STORAGE_BACKEND` injection token (Symbol).
  - `StorageService` now `constructor(@Inject(STORAGE_BACKEND) backend: StorageBackend)`; `buildVersionKey` unchanged; `putObjectStream/getObjectStream/deleteObject/objectExists` delegate.

- [ ] **Step 1: Write the failing factory test** — `apps/api/src/storage/__tests__/storage-backend.factory.spec.ts`

```ts
import { createStorageBackend } from '../storage-backend.factory';
import { FsStorageBackend } from '../storage-backend.fs';
import { S3StorageBackend } from '../storage-backend.s3';

const base = {
  endpoint: 'http://localhost:9000', region: 'us-east-1', bucket: 'nodescope',
  accessKeyId: 'a', secretAccessKey: 'b', forcePathStyle: true, fsRoot: '/tmp/x',
};

describe('createStorageBackend', () => {
  it('returns FsStorageBackend when driver=fs', () => {
    expect(createStorageBackend({ ...base, driver: 'fs' })).toBeInstanceOf(FsStorageBackend);
  });
  it('returns S3StorageBackend when driver=s3', () => {
    expect(createStorageBackend({ ...base, driver: 's3' })).toBeInstanceOf(S3StorageBackend);
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `NODE_OPTIONS="--experimental-vm-modules --no-warnings" npx jest --config jest.unit.config.ts src/storage/__tests__/storage-backend.factory.spec.ts`
Expected: FAIL — cannot find `createStorageBackend`.

- [ ] **Step 3: Implement the factory** — `apps/api/src/storage/storage-backend.factory.ts`

```ts
import { S3Client } from '@aws-sdk/client-s3';
import type { storageConfig } from '../common/config/storage.config';
import { StorageBackend } from './storage-backend';
import { FsStorageBackend } from './storage-backend.fs';
import { S3StorageBackend } from './storage-backend.s3';

/** Selects the storage backend from config. One place; shared by module + seed + migration. */
export function createStorageBackend(config: ReturnType<typeof storageConfig>): StorageBackend {
  if (config.driver === 'fs') return new FsStorageBackend(config.fsRoot);
  const s3 = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return new S3StorageBackend(s3, config.bucket);
}
```

- [ ] **Step 4: Run factory test, watch pass**

Run: `NODE_OPTIONS="--experimental-vm-modules --no-warnings" npx jest --config jest.unit.config.ts src/storage/__tests__/storage-backend.factory.spec.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite `storage.service.spec.ts` to a delegating StorageService** — replace `apps/api/src/storage/__tests__/storage.service.spec.ts`

```ts
import { Readable } from 'node:stream';
import { StorageService, STORAGE_BACKEND } from '../storage.service';
import { Test } from '@nestjs/testing';

describe('StorageService (delegates to backend)', () => {
  const backend = {
    ensureReady: jest.fn(), put: jest.fn(), get: jest.fn(),
    delete: jest.fn(), exists: jest.fn(), list: jest.fn(),
  };
  let service: StorageService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const ref = await Test.createTestingModule({
      providers: [StorageService, { provide: STORAGE_BACKEND, useValue: backend }],
    }).compile();
    service = ref.get(StorageService);
  });

  it('builds an org/building/version key', () => {
    expect(service.buildVersionKey('o1', 'b1', 'v1')).toBe('org/o1/building/b1/v1.ifc');
  });

  it('putObjectStream delegates to backend.put', async () => {
    const body = Readable.from(Buffer.from('x'));
    await service.putObjectStream('k', body, 'image/png');
    expect(backend.put).toHaveBeenCalledWith('k', body, 'image/png');
  });

  it('getObjectStream / deleteObject / objectExists delegate', async () => {
    backend.exists.mockResolvedValue(true);
    await service.getObjectStream('k');
    await service.deleteObject('k');
    expect(await service.objectExists('k')).toBe(true);
    expect(backend.get).toHaveBeenCalledWith('k');
    expect(backend.delete).toHaveBeenCalledWith('k');
    expect(backend.exists).toHaveBeenCalledWith('k');
  });
});
```

- [ ] **Step 6: Run it, watch it fail**

Run: `NODE_OPTIONS="--experimental-vm-modules --no-warnings" npx jest --config jest.unit.config.ts src/storage/__tests__/storage.service.spec.ts`
Expected: FAIL — `STORAGE_BACKEND` not exported / StorageService still takes `S3_CLIENT`.

- [ ] **Step 7: Rewrite `storage.service.ts` to delegate** — replace `apps/api/src/storage/storage.service.ts`

```ts
import { Injectable, Inject } from '@nestjs/common';
import { Readable } from 'node:stream';
import { StorageBackend } from './storage-backend';

export const STORAGE_BACKEND = Symbol('STORAGE_BACKEND');

/**
 * The single seam consumers use for object storage. Keeps the pure key builder and
 * delegates blob operations to the configured backend (S3 or filesystem).
 */
@Injectable()
export class StorageService {
  constructor(@Inject(STORAGE_BACKEND) private readonly backend: StorageBackend) {}

  buildVersionKey(organizationId: string, propertyId: string, versionId: string): string {
    return `org/${organizationId}/building/${propertyId}/${versionId}.ifc`;
  }

  ensureBucket(): Promise<void> {
    return this.backend.ensureReady();
  }

  putObjectStream(key: string, body: Readable, contentType = 'application/octet-stream'): Promise<void> {
    return this.backend.put(key, body, contentType);
  }

  getObjectStream(key: string): Promise<Readable> {
    return this.backend.get(key);
  }

  deleteObject(key: string): Promise<void> {
    return this.backend.delete(key);
  }

  objectExists(key: string): Promise<boolean> {
    return this.backend.exists(key);
  }
}
```

- [ ] **Step 8: Rewrite `storage.module.ts` to wire the backend** — replace `apps/api/src/storage/storage.module.ts`

```ts
import { Module, OnModuleInit } from '@nestjs/common';
import { storageConfig } from '../common/config/storage.config';
import { StorageService, STORAGE_BACKEND } from './storage.service';
import { createStorageBackend } from './storage-backend.factory';
import { StorageBackend } from './storage-backend';

@Module({
  providers: [
    StorageService,
    { provide: STORAGE_BACKEND, useFactory: () => createStorageBackend(storageConfig()) },
  ],
  exports: [StorageService],
})
export class StorageModule implements OnModuleInit {
  constructor(private readonly storage: StorageService) {}

  async onModuleInit(): Promise<void> {
    await this.storage.ensureBucket(); // delegates to backend.ensureReady()
  }
}
```

- [ ] **Step 9: Run storage tests + typecheck**

Run: `NODE_OPTIONS="--experimental-vm-modules --no-warnings" npx jest --config jest.unit.config.ts src/storage/__tests__/`
Expected: PASS (all storage specs).
Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0 (no consumer used `S3_CLIENT`; BCF/building-models use only StorageService methods, unchanged).

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/storage/
git commit -m "feat(storage): delegate StorageService to a pluggable backend via factory"
```

---

### Task 6: Seed uses the storage factory (drop the S3 duplication)

**Files:**
- Modify: `apps/api/prisma/seed.ts` (the storage block around lines 300–320)

**Interfaces:**
- Consumes: `createStorageBackend`, `storageConfig`.

- [ ] **Step 1: Add imports** at the top of `apps/api/prisma/seed.ts`:

```ts
import { createStorageBackend } from '../src/storage/storage-backend.factory';
import { storageConfig } from '../src/common/config/storage.config';
```
and remove the now-unused `S3Client, CreateBucketCommand` (from `@aws-sdk/client-s3`) and `Upload` (from `@aws-sdk/lib-storage`) imports. Keep the `Readable` import.

- [ ] **Step 2: Replace seed.ts lines 301–336** (the `// Construct the S3 client…` block through the `Upload(...).done()`) with the factory, keeping the `versionId`/`storageKey` construction that currently sits at lines 323–325:

```ts
  const versionId = randomUUID();
  const storageKey = `org/${organizationId}/building/${building.id}/${versionId}.ifc`;

  // Write the placeholder IFC via the configured storage backend (s3 or fs).
  const storage = createStorageBackend(storageConfig());
  await storage.ensureReady();
  await storage.put(storageKey, Readable.from(VALID_IFC), 'application/octet-stream');
```
(`VALID_IFC`, `contentHash`, `sizeBytes` at lines 295–299 stay; the `buildingModel` create at line 338+ continues to use `storageKey`.)

- [ ] **Step 3: Verify the seed uses the fs backend** — run the seed against a fresh temp root with the fs driver:

```bash
cd /workspace
STORAGE_DRIVER=fs STORAGE_FS_ROOT=/tmp/seed-fs-test npm run db:seed
ls -R /tmp/seed-fs-test | head
```
Expected: the seed completes and `/tmp/seed-fs-test/org/.../*.ifc` exists (the placeholder written via the fs backend). (DB may already be seeded — the storage `put` still runs on the building-model step, or shows "already seeded"; if fully skipped, run against a fresh test DB.)

- [ ] **Step 4: Typecheck the seed**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/seed.ts
git commit -m "refactor(seed): use the storage factory instead of a duplicated S3 client"
```

---

### Task 7: FS-mode boot e2e

**Files:**
- Create: `apps/api/src/__tests__/storage-fs/fs-boot.e2e.ts`

**Interfaces:**
- Consumes: `AppModule`, `AI_PROVIDER_TOKEN`.

- [ ] **Step 1: Write the e2e** — `apps/api/src/__tests__/storage-fs/fs-boot.e2e.ts`

```ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { AI_PROVIDER_TOKEN } from '../../ai/adapters/ai-provider.interface';

const mockAdapter = { complete: jest.fn(), stream: jest.fn() };

describe('App boots with STORAGE_DRIVER=fs (filesystem storage)', () => {
  let app: INestApplication;
  let fsRoot: string;
  const saved = { driver: process.env.STORAGE_DRIVER, root: process.env.STORAGE_FS_ROOT };

  beforeAll(async () => {
    fsRoot = mkdtempSync(path.join(tmpdir(), 'nodescope-e2e-fs-'));
    process.env.STORAGE_DRIVER = 'fs';
    process.env.STORAGE_FS_ROOT = fsRoot;

    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER_TOKEN).useValue(mockAdapter).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app?.close();
    if (saved.driver !== undefined) process.env.STORAGE_DRIVER = saved.driver; else delete process.env.STORAGE_DRIVER;
    if (saved.root !== undefined) process.env.STORAGE_FS_ROOT = saved.root; else delete process.env.STORAGE_FS_ROOT;
  });

  it('created the fs root on boot (ensureReady)', () => {
    expect(existsSync(fsRoot)).toBe(true);
  });

  it('an IFC upload → activate → download round-trips through the filesystem', async () => {
    const agent = request.agent(app.getHttpServer());
    const email = `fs-e2e-${Date.now()}@example.com`;
    await agent.post('/api/auth/sign-up/email').send({ email, password: 'Password123!', name: 'FS E2E' }).expect(200);

    const props = (await agent.get('/api/v1/properties').expect(200)).body.data as Array<{ id: string; name: string; type: string }>;
    const building = props.find((p) => p.type === 'BUILDING');
    if (!building) throw new Error('no seeded building for this org');

    const ifc = Buffer.from('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n');
    const up = await agent
      .post(`/api/v1/buildings/${building.id}/model/versions?fileName=fs.ifc`)
      .set('Content-Type', 'application/octet-stream').send(ifc).expect(201);
    const versionId = up.body.data.id as string;

    await agent.put(`/api/v1/buildings/${building.id}/model/active`).send({ versionId }).expect(200);

    const dl = await agent.get(`/api/v1/buildings/${building.id}/model/active/file`).expect(200);
    expect(Buffer.from(dl.body).subarray(0, 12).toString('latin1')).toBe('ISO-10303-21');
  });
});
```

- [ ] **Step 2: Run it, watch it pass** (needs the test DB on 5433; storage is fs so no MinIO needed)

Run: `cd apps/api && NODE_OPTIONS="--experimental-vm-modules --no-warnings" npx jest --config jest.e2e.config.ts src/__tests__/storage-fs/fs-boot.e2e.ts`
Expected: PASS (2 tests). Note: this e2e's org is freshly signed-up, so it has the seeded building only if the sign-up seeds a default org+building; if the API's sign-up flow does not create a building, adapt the test to create a site+building via the properties API first (Task 7 self-contained). Verify the actual sign-up seeding behavior when running.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/__tests__/storage-fs/fs-boot.e2e.ts
git commit -m "test(storage): e2e — app boots + IFC round-trips on filesystem storage"
```

---

### Task 8: Migration tool (`apps/api/src/storage/migrate-storage.ts`)

A plain `.mjs` cannot `import` a `.ts` module under `node` at runtime, so the tool is a
TypeScript module in the api (compiled to `dist/` by `nest build`, so the appliance image
can run it) with a `require.main` CLI guard. The api compiles to CommonJS, so
`require.main === module` is the correct entry guard.

**Files:**
- Create: `apps/api/src/storage/migrate-storage.ts`
- Test: `apps/api/src/storage/__tests__/migrate-storage.spec.ts`
- Modify: root `package.json` (add a `migrate-storage` script)

**Interfaces:**
- Consumes: `FsStorageBackend`, `S3StorageBackend` (built by `makeBackend(kind)` from env).
- Produces: `migrateStorage({ source, dest, dryRun }): Promise<{ copied: number; skipped: number; failed: number }>` — pure over two `StorageBackend`s, unit-testable without S3.

- [ ] **Step 1: Write the failing test** — `apps/api/src/storage/__tests__/migrate-storage.spec.ts`

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { FsStorageBackend } from '../storage-backend.fs';
import { migrateStorage } from '../migrate-storage';

describe('migrateStorage (fs → fs)', () => {
  it('copies missing keys, skips ones already present at matching size, respects dry-run', async () => {
    const src = new FsStorageBackend(mkdtempSync(path.join(tmpdir(), 'src-')));
    const dst = new FsStorageBackend(mkdtempSync(path.join(tmpdir(), 'dst-')));
    await src.ensureReady(); await dst.ensureReady();
    await src.put('org/a.ifc', Readable.from(Buffer.from('hello')), 'x');
    await src.put('org/b.png', Readable.from(Buffer.from('world!')), 'x');
    await dst.put('org/a.ifc', Readable.from(Buffer.from('hello')), 'x'); // already present, same size

    const dry = await migrateStorage({ source: src, dest: dst, dryRun: true });
    expect(dry).toEqual({ copied: 1, skipped: 1, failed: 0 });
    expect(await dst.exists('org/b.png')).toBe(false); // dry-run wrote nothing

    const run = await migrateStorage({ source: src, dest: dst, dryRun: false });
    expect(run).toEqual({ copied: 1, skipped: 1, failed: 0 });
    expect(await dst.exists('org/b.png')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `cd apps/api && NODE_OPTIONS="--experimental-vm-modules --no-warnings" npx jest --config jest.unit.config.ts src/storage/__tests__/migrate-storage.spec.ts`
Expected: FAIL — cannot find `../migrate-storage`.

- [ ] **Step 3: Implement** — `apps/api/src/storage/migrate-storage.ts`

```ts
import { S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { StorageBackend } from './storage-backend';
import { FsStorageBackend } from './storage-backend.fs';
import { S3StorageBackend } from './storage-backend.s3';

function sizeOf(stream: Readable): Promise<number> {
  return new Promise((resolve, reject) => {
    let n = 0;
    stream.on('data', (c: Buffer) => (n += c.length));
    stream.on('end', () => resolve(n));
    stream.on('error', reject);
  });
}

/** Copy every source key to dest; skip keys already present at matching size. Pure over backends. */
export async function migrateStorage(opts: {
  source: StorageBackend;
  dest: StorageBackend;
  dryRun: boolean;
}): Promise<{ copied: number; skipped: number; failed: number }> {
  const { source, dest, dryRun } = opts;
  const keys = await source.list();
  let copied = 0, skipped = 0, failed = 0;
  for (const key of keys) {
    try {
      const srcSize = await sizeOf(await source.get(key));
      if (await dest.exists(key)) {
        const dstSize = await sizeOf(await dest.get(key));
        if (dstSize === srcSize) { skipped++; continue; }
      }
      if (!dryRun) await dest.put(key, await source.get(key), 'application/octet-stream');
      copied++;
    } catch {
      failed++;
    }
  }
  return { copied, skipped, failed };
}

export function makeBackend(kind: 's3' | 'fs'): StorageBackend {
  if (kind === 'fs') {
    const root = process.env.STORAGE_FS_ROOT;
    if (!root) throw new Error('STORAGE_FS_ROOT must be set for fs');
    return new FsStorageBackend(root);
  }
  const s3 = new S3Client({
    endpoint: process.env.STORAGE_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.STORAGE_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY ?? 'minioadmin',
      secretAccessKey: process.env.STORAGE_SECRET_KEY ?? 'minioadmin',
    },
  });
  return new S3StorageBackend(s3, process.env.STORAGE_BUCKET ?? 'nodescope');
}

// CLI: `node dist/storage/migrate-storage.js --from s3 --to fs [--dry-run]`
if (require.main === module) {
  const args = process.argv.slice(2);
  const from = args[args.indexOf('--from') + 1] as 's3' | 'fs';
  const to = args[args.indexOf('--to') + 1] as 's3' | 'fs';
  const dryRun = args.includes('--dry-run');
  if (!['s3', 'fs'].includes(from) || !['s3', 'fs'].includes(to)) {
    console.error('usage: migrate-storage --from s3|fs --to s3|fs [--dry-run]');
    process.exit(1);
  }
  void (async () => {
    const source = makeBackend(from);
    const dest = makeBackend(to);
    await dest.ensureReady();
    const r = await migrateStorage({ source, dest, dryRun });
    console.log(`${dryRun ? '[dry-run] ' : ''}copied=${r.copied} skipped=${r.skipped} failed=${r.failed}`);
    process.exit(r.failed ? 1 : 0);
  })();
}
```

- [ ] **Step 4: Run it, watch it pass**

Run: `cd apps/api && NODE_OPTIONS="--experimental-vm-modules --no-warnings" npx jest --config jest.unit.config.ts src/storage/__tests__/migrate-storage.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Add the runner script** to root `package.json` `scripts` (runs the compiled output; the api image has `dist/`):

```json
    "migrate-storage": "node apps/api/dist/storage/migrate-storage.js",
```
Usage after `npm run build`: `npm run migrate-storage -- --from s3 --to fs [--dry-run]` (with both `STORAGE_*` and `STORAGE_FS_ROOT` set). In the appliance: `docker compose run --rm api node dist/storage/migrate-storage.js --from s3 --to fs`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/storage/migrate-storage.ts apps/api/src/storage/__tests__/migrate-storage.spec.ts package.json
git commit -m "feat(storage): migrate-storage tool (copy blobs between backends, either direction)"
```

---

### Task 9: `.env.example` + deploy (fs mode, drop MinIO)

**Files:**
- Modify: `.env.example`
- Modify: `deploy/Dockerfile.api`
- Modify: `deploy/docker-compose.demo.yml`
- Modify: `deploy/.env.demo`

**Interfaces:** none (config/docs).

- [ ] **Step 1: Document the driver in `.env.example`** — under the storage block, add:

```bash
# Storage driver: s3 (default; S3/MinIO) or fs (local filesystem, single-node appliance).
STORAGE_DRIVER=s3
# Filesystem storage root (used only when STORAGE_DRIVER=fs).
STORAGE_FS_ROOT=./var/storage
```

- [ ] **Step 2: Pre-create the fs root owned by `node` in `deploy/Dockerfile.api`** — in the runtime stage, before `USER node`, add:

```dockerfile
# FS storage mode writes blobs here; pre-create it owned by node so a mounted
# volume at this path is writable by the (non-root) runtime user.
RUN mkdir -p /data/storage && chown -R node:node /data/storage
```

- [ ] **Step 3: Switch the demo to fs + drop MinIO** — in `deploy/docker-compose.demo.yml`: remove the `minio` service and the `miniodata` volume; remove the `depends_on: minio` and the `STORAGE_ENDPOINT/REGION/BUCKET/ACCESS_KEY/SECRET_KEY` env from `api`; instead add to the `api` (and `demo-seed`) environment:

```yaml
      STORAGE_DRIVER: fs
      STORAGE_FS_ROOT: /data/storage
```
  and give `api` a named volume for the blobs:
```yaml
    volumes:
      - blobstore:/data/storage
```
  and declare it:
```yaml
volumes:
  blobstore:
```

- [ ] **Step 4: Update `deploy/.env.demo`** — remove the MinIO-specific `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` reliance; add:

```bash
STORAGE_DRIVER=fs
STORAGE_FS_ROOT=/data/storage
```

- [ ] **Step 5: Validate compose YAML** (Docker isn't available in-sandbox; validate structurally):

Run:
```bash
node -e 'const y=require("js-yaml");const fs=require("fs");for(const f of ["deploy/docker-compose.prod.yml","deploy/docker-compose.demo.yml"]){const d=y.load(fs.readFileSync(f,"utf8"));console.log("OK",f,Object.keys(d.services).join(","))}'
```
Expected: both parse; demo services are `api, demo-seed` (no `minio`).

- [ ] **Step 6: Update `deploy/DEMO.md`** — replace the "MinIO (object storage…)" line with "filesystem storage (blobs on a local Docker volume, no MinIO)", and drop any MinIO mention from the health-check note.

- [ ] **Step 7: Commit**

```bash
git add .env.example deploy/Dockerfile.api deploy/docker-compose.demo.yml deploy/.env.demo deploy/DEMO.md
git commit -m "feat(deploy): fs storage mode for the demo (drop MinIO); document STORAGE_DRIVER"
```

---

## Final verification (after all tasks)

- [ ] Full storage unit suite: `cd apps/api && NODE_OPTIONS="--experimental-vm-modules --no-warnings" npx jest --config jest.unit.config.ts src/storage/ src/common/config/__tests__/storage.config.spec.ts` → all pass.
- [ ] Whole API unit suite green (no regression from the seam change): `npm run test:unit` (from apps/api).
- [ ] Integration + e2e with the fs e2e added: `STORAGE_ENDPOINT=http://localhost:9000 npm run test:integration && npm run test:e2e` (existing S3/MinIO e2e still green = regression; new fs e2e green).
- [ ] `npx tsc --noEmit -p apps/api/tsconfig.json` → exit 0.
- [ ] `npx eslint apps/api/src/storage scripts/migrate-storage.mjs` → clean.

## Self-review notes (author)

- **Spec coverage:** interface+FS (T2,T3), S3 lift+list (T4), factory+delegation+module (T5), config (T1), seed de-dup (T6), fs boot e2e (T7), migration both-directions (T8), deploy fs-mode/drop-MinIO + env docs (T9). All spec sections mapped.
- **Naming consistency:** `STORAGE_BACKEND` token, `createStorageBackend`, `ensureReady` (backend) vs `ensureBucket` (StorageService kept for the module call) — intentional: StorageService keeps `ensureBucket` as the public name delegating to `backend.ensureReady()` so nothing else renames.
- **Risk:** Task 7's fresh-signup org may not include a seeded building; the step says to adapt to create a site+building via the properties API if so. Task 8's `.mjs`→`.ts` import has a documented fallback.
