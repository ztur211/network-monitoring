# Spec 1 Phase A — Models, Storage Seam & Infra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `BuildingModel` + `BuildingModelVersion` models, the `Device.x/y/z` columns, the `StorageService` object-storage seam (S3-compatible / MinIO), the `BuildingModelsRepository`, shared DTOs, and error codes — purely additively, with MinIO wired into dev/test infra. No HTTP endpoints yet (Phase B); no device-position endpoint (Phase C).

**Architecture:** A new `storage` module wraps `@aws-sdk/client-s3` + `@aws-sdk/lib-storage` behind a small `StorageService` (stream in/out, delete, exists, key builder) — the only code that talks to the bucket. A new `building-models` module starts with its repository (Prisma access). Config is read from `process.env` with defaults (the codebase convention, e.g. `redis.service.ts`). MinIO runs in `docker-compose` for dev and `docker-compose.test.yml` for tests.

**Tech Stack:** NestJS 11, Prisma 5, `@aws-sdk/client-s3` + `@aws-sdk/lib-storage`, MinIO, Jest (unit + integration on test DB `:5433`, MinIO on `:9100` for tests).

**Depends on:**
- **F1a** — `Organization`, `OrganizationMember`, `ChangeLog` (+ its `entityType` CHECK), `PrismaService`, conventions.
- **F2** — `Property` with `type = BUILDING`.
- Spec: `docs/superpowers/specs/2026-06-09-spec1-spatial-foundation-design.md` (§4 data model, §4.5 storage, §10).

> Additive: nothing existing changes behavior. The `building-models` HTTP surface + proxied transfer is Phase B; `Device` position authoring is Phase C.

---

## File Structure

**Create:**
- `apps/api/src/common/config/storage.config.ts` — reads `STORAGE_*` env (precedent: `trust-proxy.config.ts`)
- `apps/api/src/storage/storage.service.ts` — the object-storage seam
- `apps/api/src/storage/storage.module.ts`
- `apps/api/src/storage/__tests__/storage.service.spec.ts` — unit (mocked S3 client)
- `apps/api/src/building-models/building-models.repository.ts`
- `apps/api/src/building-models/__tests__/building-models.repository.spec.ts` — integration

**Modify:**
- `apps/api/prisma/schema.prisma` — `BuildingModel`, `BuildingModelVersion`, `Device.x/y/z`, back-relations
- `packages/shared/src/types/api.types.ts` — DTOs
- `packages/shared/src/types/realtime.types.ts` — `v1:buildingModel:*` events
- `apps/api/package.json` — add `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`
- `docker-compose.yml`, `docker-compose.test.yml` — MinIO service
- `.env.example`, `apps/api/jest.e2e.setup.ts` — `STORAGE_*` env
- API Design Document — register `MODEL_*` / `SPATIAL_*`

---

## Task 1: Dependencies + MinIO infra

**Files:** `apps/api/package.json`, `docker-compose.yml`, `docker-compose.test.yml`, `.env.example`, `apps/api/jest.e2e.setup.ts`.

- [ ] **Step 1: Add the AWS SDK deps.** `cd apps/api && npm i @aws-sdk/client-s3 @aws-sdk/lib-storage` → both appear in `apps/api/package.json` dependencies.

- [ ] **Step 2: Add MinIO to `docker-compose.yml`** (dev), after the `redis` service:

```yaml
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - miniodata:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 10
```

Add `miniodata:` under the top-level `volumes:`.

- [ ] **Step 3: Add MinIO to `docker-compose.test.yml`** on non-default ports (mirror the DB-on-5433 convention) — host `:9100`, ephemeral `tmpfs`:

```yaml
  minio-test:
    image: minio/minio:latest
    command: server /data
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9100:9000"
    tmpfs:
      - /data
```

- [ ] **Step 4: Add `STORAGE_*` to `.env.example`:**

```bash
# Object storage (S3-compatible; MinIO in dev/test)
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_REGION=us-east-1
STORAGE_BUCKET=nodescope
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
MODEL_MAX_BYTES=209715200
```

- [ ] **Step 5: Point tests at the test MinIO.** In `apps/api/jest.e2e.setup.ts`, add (alongside the existing `DATABASE_URL`/`REDIS_URL` defaults):

```typescript
process.env.STORAGE_ENDPOINT ??= 'http://localhost:9100';
process.env.STORAGE_BUCKET ??= 'nodescope-test';
process.env.STORAGE_ACCESS_KEY ??= 'minioadmin';
process.env.STORAGE_SECRET_KEY ??= 'minioadmin';
```

- [ ] **Step 6: Commit** `chore(api): add AWS S3 SDK deps + MinIO dev/test infra + STORAGE_* env`.

---

## Task 2: Schema — `BuildingModel`, `BuildingModelVersion`, `Device.x/y/z`

**Files:** Modify `apps/api/prisma/schema.prisma`; generated migration.

- [ ] **Step 1: Add the models** (spec §4.1–4.2)

```prisma
model BuildingModel {
  id              String   @id @default(uuid())
  organizationId  String
  propertyId      String
  name            String
  activeVersionId String?
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  organization  Organization           @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  property      Property               @relation(fields: [propertyId], references: [id], onDelete: Restrict)
  activeVersion BuildingModelVersion?  @relation("ActiveVersion", fields: [activeVersionId], references: [id], onDelete: SetNull)
  versions      BuildingModelVersion[] @relation("ModelVersions")

  @@unique([organizationId, propertyId])
  @@index([organizationId])
}

model BuildingModelVersion {
  id                 String   @id @default(uuid())
  organizationId     String
  buildingModelId    String
  versionNumber      Int
  storageKey         String
  fileName           String
  contentHash        String
  sizeBytes          Int
  units              String?
  uploadedByMemberId String?
  createdAt          DateTime @default(now())

  organization  Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  buildingModel BuildingModel @relation("ModelVersions", fields: [buildingModelId], references: [id], onDelete: Cascade)

  @@unique([buildingModelId, versionNumber])
  @@index([organizationId])
  @@index([buildingModelId])
}
```

- [ ] **Step 2: Add `Device.x/y/z`** (additive, nullable) and back-relations:

```prisma
// in model Device, alongside latitude/longitude/floor:
  x Float?
  y Float?
  z Float?
```
Back-relations: `Organization` gains `buildingModels BuildingModel[]`, `buildingModelVersions BuildingModelVersion[]`; `Property` gains `buildingModel BuildingModel? @relation` (the inverse of `BuildingModel.property`).

- [ ] **Step 3: Create the migration.** `cd apps/api && npx prisma migrate dev --name spec1_building_models_and_device_xyz` → created + applied; client regenerates.

- [ ] **Step 4: Extend the `ChangeLog` CHECK (raw SQL).** Append to the generated `migration.sql`:

```sql
ALTER TABLE "ChangeLog" DROP CONSTRAINT IF EXISTS "changelog_entity_type_check";
ALTER TABLE "ChangeLog" ADD CONSTRAINT "changelog_entity_type_check"
  CHECK ("entityType" IN ('Device','Circuit','FiberRun','DeviceConnection','Property','NetworkProperty',
                          'BuildingModel','BuildingModelVersion'));
```
Re-apply (greenfield): `cd apps/api && npx prisma migrate reset --force`.

- [ ] **Step 5: `npx tsc --noEmit`** → PASS. **Commit** `feat(api): add BuildingModel/BuildingModelVersion + Device x/y/z`.

---

## Task 3: Shared DTOs + WS events + error codes

**Files:** `packages/shared/src/types/api.types.ts`, `realtime.types.ts`; API Design Document.

- [ ] **Step 1: DTOs in `api.types.ts`** (spec §10.1)

```typescript
export interface BuildingModelDto {
  id: string;
  organizationId: string;
  propertyId: string;
  name: string;
  activeVersionId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BuildingModelVersionDto {
  id: string;
  buildingModelId: string;
  versionNumber: number;
  fileName: string;
  contentHash: string;
  sizeBytes: number;
  units: string | null;
  uploadedByMemberId: string | null;
  createdAt: string;
}

export interface DevicePositionDto { x: number | null; y: number | null; z: number | null; }
// DeviceDto gains: x: number | null; y: number | null; z: number | null;
```

- [ ] **Step 2: WS events in `realtime.types.ts`** (in `WS_EVENTS`)

```typescript
BUILDING_MODEL_VERSION_UPLOADED: 'v1:buildingModel:versionUploaded',
BUILDING_MODEL_ACTIVATED: 'v1:buildingModel:activated',
BUILDING_MODEL_DELETED: 'v1:buildingModel:deleted',
```

- [ ] **Step 3: Build shared.** `cd packages/shared && npm run build` → PASS.

- [ ] **Step 4: Register codes** in the API Design Document (spec §10.3): `MODEL_001 BUILDING_MODEL_NOT_FOUND` (404), `MODEL_002 PROPERTY_NOT_BUILDING` (422), `MODEL_004 MODEL_VERSION_NOT_FOUND` (404), `MODEL_005 CANNOT_DELETE_ACTIVE_VERSION` (409), `MODEL_006 MODEL_FILE_TOO_LARGE` (413), `MODEL_007 INVALID_IFC_FILE` (422), `MODEL_008 BUILDING_HAS_MODEL` (409), `SPATIAL_001 DEVICE_NOT_IN_MODELED_BUILDING` (422), `SPATIAL_002 INCOMPLETE_POSITION` (422). (No `MODEL_003` — creation is implicit, spec §10.3.)

- [ ] **Step 5: Commit** `feat(shared): BuildingModel DTOs + WS events; docs: register MODEL_*/SPATIAL_*`.

---

## Task 4: `StorageService` (unit TDD, mocked S3 client)

**Files:** Create `common/config/storage.config.ts`, `storage/storage.service.ts`, `storage/storage.module.ts`; test `storage/__tests__/storage.service.spec.ts`.

The S3 client is provided via an injectable token so tests inject a fake.

- [ ] **Step 1: Config helper** `common/config/storage.config.ts`

```typescript
export const storageConfig = () => ({
  endpoint: process.env.STORAGE_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.STORAGE_REGION ?? 'us-east-1',
  bucket: process.env.STORAGE_BUCKET ?? 'nodescope',
  accessKeyId: process.env.STORAGE_ACCESS_KEY ?? 'minioadmin',
  secretAccessKey: process.env.STORAGE_SECRET_KEY ?? 'minioadmin',
  forcePathStyle: true, // required for MinIO
});
```

- [ ] **Step 2: Write the failing unit test**

```typescript
import { Test } from '@nestjs/testing';
import { StorageService, S3_CLIENT } from '../storage.service';
import { HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

describe('StorageService (unit, mocked S3)', () => {
  let service: StorageService;
  const send = jest.fn();
  const fakeClient = { send } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const ref = await Test.createTestingModule({
      providers: [StorageService, { provide: S3_CLIENT, useValue: fakeClient }],
    }).compile();
    service = ref.get(StorageService);
  });

  it('builds an org/building/version key', () => {
    expect(service.buildVersionKey('o1', 'b1', 'v1')).toBe('org/o1/building/b1/v1.ifc');
  });

  it('objectExists is false when HEAD throws (404)', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('NotFound'), { name: 'NotFound' }));
    expect(await service.objectExists('k')).toBe(false);
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
  });

  it('deleteObject issues a DeleteObjectCommand', async () => {
    send.mockResolvedValueOnce({});
    await service.deleteObject('k');
    expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
  });
});
```

- [ ] **Step 3: Run → FAIL.** `cd apps/api && npm run test:unit -- storage.service`.

- [ ] **Step 4: Implement `storage.service.ts`**

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { Readable } from 'node:stream';
import { S3Client, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { storageConfig } from '../common/config/storage.config';

export const S3_CLIENT = Symbol('S3_CLIENT');

@Injectable()
export class StorageService {
  private readonly bucket = storageConfig().bucket;
  constructor(@Inject(S3_CLIENT) private readonly s3: S3Client) {}

  buildVersionKey(organizationId: string, propertyId: string, versionId: string): string {
    return `org/${organizationId}/building/${propertyId}/${versionId}.ifc`;
  }

  async ensureBucket(): Promise<void> {
    try { await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket })); }
    catch (e: any) { if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(e?.name)) throw e; }
  }

  async putObjectStream(key: string, body: Readable, contentType = 'application/octet-stream'): Promise<void> {
    await new Upload({ client: this.s3, params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType } }).done();
  }

  async getObjectStream(key: string): Promise<Readable> {
    const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return out.Body as Readable;
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async objectExists(key: string): Promise<boolean> {
    try { await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })); return true; }
    catch { return false; }
  }
}
```

- [ ] **Step 5: `storage.module.ts`** — provide the real client + the service, call `ensureBucket()` on init:

```typescript
import { Module, OnModuleInit } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { storageConfig } from '../common/config/storage.config';
import { StorageService, S3_CLIENT } from './storage.service';

@Module({
  providers: [
    StorageService,
    { provide: S3_CLIENT, useFactory: () => {
      const c = storageConfig();
      return new S3Client({ endpoint: c.endpoint, region: c.region, forcePathStyle: c.forcePathStyle,
        credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey } });
    } },
  ],
  exports: [StorageService],
})
export class StorageModule implements OnModuleInit {
  constructor(private readonly storage: StorageService) {}
  async onModuleInit() { await this.storage.ensureBucket(); }
}
```

- [ ] **Step 6: Run → PASS.** Commit `feat(api): StorageService object-storage seam (S3/MinIO)`.

---

## Task 5: `BuildingModelsRepository` (integration TDD)

**Files:** Create `building-models/building-models.repository.ts`; test `building-models/__tests__/building-models.repository.spec.ts`.

- [ ] **Step 1: Write the failing integration test**

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { BuildingModelsRepository } from '../building-models.repository';

describe('BuildingModelsRepository (integration)', () => {
  let repo: BuildingModelsRepository;
  let prisma: PrismaService;
  let orgId: string; let buildingId: string;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ providers: [BuildingModelsRepository, PrismaService] }).compile();
    repo = ref.get(BuildingModelsRepository); prisma = ref.get(PrismaService); await prisma.$connect();
  });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: `BM${Date.now()}${Math.round(performance.now())}` } });
    orgId = org.id;
    const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'S' } });
    const bld = await prisma.property.create({ data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'B' } });
    buildingId = bld.id;
  });
  afterEach(async () => { await prisma.organization.delete({ where: { id: orgId } }); });

  it('creates a model, adds versions with incrementing numbers, sets active, blocks dup building', async () => {
    const model = await repo.createModel({ organizationId: orgId, propertyId: buildingId, name: 'B' });
    const v1 = await repo.createVersion({ organizationId: orgId, buildingModelId: model.id, versionNumber: 1, storageKey: 'k1', fileName: 'a.ifc', contentHash: 'h1', sizeBytes: 10, units: 'METRE', uploadedByMemberId: null });
    await repo.setActiveVersion(orgId, model.id, v1.id, model.version);
    const reloaded = await repo.findByProperty(orgId, buildingId);
    expect(reloaded?.activeVersionId).toBe(v1.id);
    expect(await repo.nextVersionNumber(orgId, model.id)).toBe(2);
    await expect(repo.createModel({ organizationId: orgId, propertyId: buildingId, name: 'dup' })).rejects.toThrow(); // P2002
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:integration -- building-models`.

- [ ] **Step 3: Implement `building-models.repository.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { BuildingModel, BuildingModelVersion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BuildingModelsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createModel(data: { organizationId: string; propertyId: string; name: string }): Promise<BuildingModel> {
    return this.prisma.buildingModel.create({ data });
  }
  findByProperty(organizationId: string, propertyId: string): Promise<BuildingModel | null> {
    return this.prisma.buildingModel.findFirst({ where: { organizationId, propertyId } });
  }
  findModelById(organizationId: string, id: string): Promise<BuildingModel | null> {
    return this.prisma.buildingModel.findFirst({ where: { id, organizationId } });
  }
  async nextVersionNumber(organizationId: string, buildingModelId: string): Promise<number> {
    const last = await this.prisma.buildingModelVersion.findFirst({
      where: { organizationId, buildingModelId }, orderBy: { versionNumber: 'desc' }, select: { versionNumber: true },
    });
    return (last?.versionNumber ?? 0) + 1;
  }
  createVersion(data: {
    organizationId: string; buildingModelId: string; versionNumber: number; storageKey: string;
    fileName: string; contentHash: string; sizeBytes: number; units: string | null; uploadedByMemberId: string | null;
  }): Promise<BuildingModelVersion> {
    return this.prisma.buildingModelVersion.create({ data });
  }
  listVersions(organizationId: string, buildingModelId: string): Promise<BuildingModelVersion[]> {
    return this.prisma.buildingModelVersion.findMany({ where: { organizationId, buildingModelId }, orderBy: { versionNumber: 'desc' } });
  }
  findVersion(organizationId: string, versionId: string): Promise<BuildingModelVersion | null> {
    return this.prisma.buildingModelVersion.findFirst({ where: { id: versionId, organizationId } });
  }
  async setActiveVersion(organizationId: string, modelId: string, versionId: string, expectedVersion: number): Promise<boolean> {
    const r = await this.prisma.buildingModel.updateMany({
      where: { id: modelId, organizationId, version: expectedVersion },
      data: { activeVersionId: versionId, version: { increment: 1 } },
    });
    return r.count > 0;
  }
  deleteVersion(organizationId: string, versionId: string) {
    return this.prisma.buildingModelVersion.deleteMany({ where: { id: versionId, organizationId } });
  }
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): BuildingModelsRepository`.

---

## Task 6: Phase gate

- [ ] **Step 1: Full suite** (bring up infra first): `docker compose -f docker-compose.test.yml up -d`, then `cd apps/api && npm run test:unit && npm run test:integration` → green.
- [ ] **Step 2: Docs (Rule 10).** Note in CLAUDE.md/SAD that object storage (MinIO) is now a dependency and the `StorageService` is the sole bucket accessor.
- [ ] **Step 3: Commit** `docs: record Spec 1 storage seam + building-model schema (Phase A)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** `BuildingModel`/`BuildingModelVersion` (§4.1–4.2) ✓ Task 2; `Device.x/y/z` (§4.3) ✓ Task 2; object-storage seam + key layout + config + MinIO (§4.5) ✓ Tasks 1, 4; immutable-version data shape + active pointer column (§4.1, §5) ✓ Task 2 (mechanics in Phase B); DTOs/events/codes (§10) ✓ Task 3; `ChangeLog` CHECK extended for new entity types ✓ Task 2 Step 4.
- **Deferred (correctly NOT here):** model/version HTTP API, proxied upload/download, activate/rollback/delete mechanics, audit/event emission → Phase B; device position endpoint + building-resolution + clear-on-move → Phase C.
- **Placeholder scan:** none — concrete code/commands throughout.
- **Type consistency:** `BuildingModelsRepository` methods (`createModel`/`findByProperty`/`nextVersionNumber`/`createVersion`/`setActiveVersion`/`deleteVersion`) are the surface Phase B consumes; `StorageService` (`buildVersionKey`/`putObjectStream`/`getObjectStream`/`deleteObject`/`objectExists`) is Phase B's transfer surface; DTO field names match the schema columns.
- **Test-config compliance:** `storage.service.spec.ts` (unit regex, mocked S3); `building-models.repository.spec.ts` (integration regex, real DB); real MinIO round-trip is exercised by Phase B's upload/download e2e.
- **Integration points to verify during execution:** F1a `Organization`/`ChangeLog` shape; F2 `Property` `BUILDING` type enum value; that `jest.e2e.setup.ts` exists (F1a-era) to extend with `STORAGE_*`; MinIO `mc ready` healthcheck availability in the image tag.
