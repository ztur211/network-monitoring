# Spec 1 Phase B — Building-Model API & Proxied Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The HTTP surface for building models: get model + versions, **proxied streaming upload** of an IFC (size cap + IFC magic check + content-hash while streaming to the bucket) that creates+activates a version, **proxied streaming download**, activate/rollback, delete-non-active, plus the Property delete-block (`MODEL_008`) — all org-scoped, OWNER/ADMIN-gated, audited, with realtime events.

**Architecture:** `BuildingModelsService` orchestrates `BuildingModelsRepository` (Phase A) + `StorageService` (Phase A) + F2's `PropertiesService` (validate `BUILDING`). Upload reads the raw request stream (Content-Type `application/octet-stream`, so the JSON body parser ignores it), pipes it through a metered/hashing `Transform` (enforces `MODEL_MAX_BYTES` + the `ISO-10303-21;` IFC prefix), and streams that into `StorageService.putObjectStream`; on success it writes the version row and flips the active pointer. Download returns a NestJS `StreamableFile`. Mutations are `@OrgRoles('OWNER','ADMIN')`.

**Tech Stack:** NestJS 11 (`StreamableFile`, `@Req()` raw stream), `@aws-sdk/lib-storage` `Upload`, Node `stream`/`crypto`, Jest (e2e against real MinIO `:9100`).

**Depends on:**
- **Spec 1 Phase A** — `BuildingModelsRepository`, `StorageService`, DTOs, `MODEL_*` codes, `v1:buildingModel:*` events, MinIO infra.
- **F1a** — `@OrgMember()` (or `request.orgMember`), `@OrgRoles`, `NodeScopeException`, `AuditService.recordCreate/recordDelete`, the realtime org-room emit, the `{ success, data, timestamp }` envelope.
- **F2** — `PropertiesService` to load a `Property` + assert `type = BUILDING`; the `deleteProperty` delete-block this extends.
- Spec: `2026-06-09-spec1-spatial-foundation-design.md` (§5, §7, §8, §10.5).

> If F3's `@OrgMember()` isn't available (it's introduced in F3 Phase B), resolve the member from `@OrgId()` + the current `OrganizationMember` instead — Spec 1 only needs `{ id, organizationId, role }`.

---

## File Structure

**Create:**
- `apps/api/src/building-models/metered-hashing-stream.ts` — the size/magic/hash `Transform` (pure, unit-tested)
- `apps/api/src/building-models/building-models.service.ts`
- `apps/api/src/building-models/building-models.controller.ts` — `/v1/buildings/:propertyId/model*`
- `apps/api/src/building-models/building-models.module.ts`
- `apps/api/src/building-models/__tests__/metered-hashing-stream.spec.ts` (unit — see naming note)
- `apps/api/src/building-models/__tests__/building-models.service.spec.ts` (unit)
- `apps/api/src/building-models/__tests__/building-models.e2e.ts` (e2e, real MinIO)

**Modify:**
- `apps/api/src/app.module.ts` — import `BuildingModelsModule`
- `apps/api/src/properties/properties.service.ts` — extend `deleteProperty` block (`MODEL_008`)

---

## Task 1: The metered/hashing upload `Transform`

**Files:** Create `metered-hashing-stream.ts`; test `__tests__/metered-hashing-stream.spec.ts`.

> Naming: the unit Jest regex matches `*.(service|guard|validator|…).spec.ts`. To be picked up, name the test file `metered-hashing-stream.validator.spec.ts` **or** export the factory from a `*.service.ts`. Use `metered-hashing-stream.validator.spec.ts` (it validates the stream).

- [ ] **Step 1: Write the failing unit test** (`metered-hashing-stream.validator.spec.ts`)

```typescript
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { meteredHashingStream, UploadTooLargeError, InvalidIfcError } from '../metered-hashing-stream';

async function drain(src: Readable): Promise<void> {
  return new Promise((res, rej) => { src.on('data', () => {}); src.on('end', res); src.on('error', rej); });
}

describe('meteredHashingStream', () => {
  it('passes a valid IFC through and reports sha256 + size', async () => {
    const body = Buffer.from('ISO-10303-21;\nHEADER;\n... rest ...');
    const { transform, result } = meteredHashingStream(1_000);
    Readable.from([body]).pipe(transform);
    await drain(transform);
    const r = result();
    expect(r.sizeBytes).toBe(body.length);
    expect(r.contentHash).toBe(createHash('sha256').update(body).digest('hex'));
  });

  it('errors with UploadTooLargeError past the cap', async () => {
    const { transform } = meteredHashingStream(4);
    Readable.from([Buffer.from('ISO-10303-21; way too long')]).pipe(transform);
    await expect(drain(transform)).rejects.toBeInstanceOf(UploadTooLargeError);
  });

  it('errors with InvalidIfcError when the magic prefix is wrong', async () => {
    const { transform } = meteredHashingStream(1_000);
    Readable.from([Buffer.from('NOT-AN-IFC-FILE-AT-ALL')]).pipe(transform);
    await expect(drain(transform)).rejects.toBeInstanceOf(InvalidIfcError);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:unit -- metered-hashing-stream`.

- [ ] **Step 3: Implement `metered-hashing-stream.ts`**

```typescript
import { Transform, TransformCallback } from 'node:stream';
import { createHash, Hash } from 'node:crypto';

export class UploadTooLargeError extends Error {}
export class InvalidIfcError extends Error {}

const IFC_MAGIC = 'ISO-10303-21;';

/** A Transform that passes bytes through while enforcing a max size + the IFC magic prefix and computing sha256. */
export function meteredHashingStream(maxBytes: number): { transform: Transform; result: () => { contentHash: string; sizeBytes: number } } {
  const hash: Hash = createHash('sha256');
  let size = 0;
  let head = Buffer.alloc(0);
  let magicChecked = false;

  const transform = new Transform({
    transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
      size += chunk.length;
      if (size > maxBytes) return cb(new UploadTooLargeError());
      if (!magicChecked) {
        head = Buffer.concat([head, chunk]);
        if (head.length >= IFC_MAGIC.length) {
          magicChecked = true;
          if (!head.toString('latin1', 0, IFC_MAGIC.length).startsWith(IFC_MAGIC)) return cb(new InvalidIfcError());
        }
      }
      hash.update(chunk);
      cb(null, chunk);
    },
    flush(cb: TransformCallback) {
      // a stream shorter than the magic prefix never validated → reject
      if (!magicChecked) return cb(new InvalidIfcError());
      cb();
    },
  });

  return { transform, result: () => ({ contentHash: hash.digest('hex'), sizeBytes: size }) };
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): metered/hashing IFC upload stream (size cap + magic + sha256)`.

---

## Task 2: `BuildingModelsService` — read/activate/delete (unit TDD)

**Files:** Create `building-models.service.ts`; test `building-models.service.spec.ts`.

- [ ] **Step 1: Write the failing unit test** (mock repo, storage, properties, audit, realtime)

```typescript
import { Test } from '@nestjs/testing';
import { BuildingModelsService } from '../building-models.service';
import { BuildingModelsRepository } from '../building-models.repository';
import { StorageService } from '../../storage/storage.service';
import { PropertiesService } from '../../properties/properties.service';
import { OrganizationMember } from '@prisma/client';

const owner = { id: 'o', organizationId: 'org', role: 'OWNER' } as OrganizationMember;

describe('BuildingModelsService (unit)', () => {
  let service: BuildingModelsService;
  const repo = { findByProperty: jest.fn(), findVersion: jest.fn(), setActiveVersion: jest.fn(), deleteVersion: jest.fn(), findModelById: jest.fn() } as any;
  const storage = { deleteObject: jest.fn() } as any;
  const properties = { findById: jest.fn() } as any;
  const audit = { recordDelete: jest.fn(), recordUpdate: jest.fn() } as any;
  const realtime = { emitToOrg: jest.fn() } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const ref = await Test.createTestingModule({
      providers: [
        BuildingModelsService,
        { provide: BuildingModelsRepository, useValue: repo },
        { provide: StorageService, useValue: storage },
        { provide: PropertiesService, useValue: properties },
        { provide: 'AuditService', useValue: audit },
        { provide: 'REALTIME_ORG_EMITTER', useValue: realtime },
      ],
    }).compile();
    service = ref.get(BuildingModelsService);
  });

  it('deleting the active version is blocked with MODEL_005', async () => {
    repo.findModelById.mockResolvedValue({ id: 'm', organizationId: 'org', activeVersionId: 'v1', version: 1 });
    repo.findVersion.mockResolvedValue({ id: 'v1', buildingModelId: 'm', organizationId: 'org', storageKey: 'k' });
    await expect(service.deleteVersion(owner, 'm', 'v1')).rejects.toMatchObject({ code: 'MODEL_005' });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('deleting a non-active version removes the row and the object', async () => {
    repo.findModelById.mockResolvedValue({ id: 'm', organizationId: 'org', activeVersionId: 'vACTIVE', version: 1 });
    repo.findVersion.mockResolvedValue({ id: 'v2', buildingModelId: 'm', organizationId: 'org', storageKey: 'k2' });
    repo.deleteVersion.mockResolvedValue({ count: 1 });
    await service.deleteVersion(owner, 'm', 'v2');
    expect(repo.deleteVersion).toHaveBeenCalledWith('org', 'v2');
    expect(storage.deleteObject).toHaveBeenCalledWith('k2');
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:unit -- building-models.service`.

- [ ] **Step 3: Implement the read/activate/delete half of `building-models.service.ts`**

```typescript
import { HttpStatus, Injectable, Inject } from '@nestjs/common';
import { OrganizationMember } from '@prisma/client';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { PropertiesService } from '../properties/properties.service';
import { StorageService } from '../storage/storage.service';
import { BuildingModelsRepository } from './building-models.repository';
import { toBuildingModelDto, toVersionDto } from './building-models.mapper';

@Injectable()
export class BuildingModelsService {
  constructor(
    private readonly repo: BuildingModelsRepository,
    private readonly storage: StorageService,
    private readonly properties: PropertiesService,
    @Inject('AuditService') private readonly audit: any,
    @Inject('REALTIME_ORG_EMITTER') private readonly realtime: { emitToOrg: (org: string, event: string, payload: unknown) => void },
  ) {}

  private async loadModelOr404(member: OrganizationMember, propertyId: string) {
    const model = await this.repo.findByProperty(member.organizationId, propertyId);
    if (!model) throw new NodeScopeException('MODEL_001', 'BUILDING_MODEL_NOT_FOUND', HttpStatus.NOT_FOUND);
    return model;
  }

  async getModel(member: OrganizationMember, propertyId: string) {
    return toBuildingModelDto(await this.loadModelOr404(member, propertyId));
  }

  async listVersions(member: OrganizationMember, propertyId: string) {
    const model = await this.loadModelOr404(member, propertyId);
    return (await this.repo.listVersions(member.organizationId, model.id)).map(toVersionDto);
  }

  async activateVersion(member: OrganizationMember, propertyId: string, versionId: string) {
    const model = await this.loadModelOr404(member, propertyId);
    const version = await this.repo.findVersion(member.organizationId, versionId);
    if (!version || version.buildingModelId !== model.id) throw new NodeScopeException('MODEL_004', 'MODEL_VERSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    const ok = await this.repo.setActiveVersion(member.organizationId, model.id, versionId, model.version);
    if (!ok) throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);
    this.realtime.emitToOrg(member.organizationId, 'v1:buildingModel:activated', { propertyId, versionId });
    return toBuildingModelDto(await this.loadModelOr404(member, propertyId));
  }

  async deleteVersion(member: OrganizationMember, propertyIdOrModelId: string, versionId: string) {
    const model = await this.repo.findModelById(member.organizationId, propertyIdOrModelId)
      ?? await this.repo.findByProperty(member.organizationId, propertyIdOrModelId);
    if (!model) throw new NodeScopeException('MODEL_001', 'BUILDING_MODEL_NOT_FOUND', HttpStatus.NOT_FOUND);
    const version = await this.repo.findVersion(member.organizationId, versionId);
    if (!version || version.buildingModelId !== model.id) throw new NodeScopeException('MODEL_004', 'MODEL_VERSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (model.activeVersionId === versionId) throw new NodeScopeException('MODEL_005', 'CANNOT_DELETE_ACTIVE_VERSION', HttpStatus.CONFLICT);
    await this.repo.deleteVersion(member.organizationId, versionId);
    await this.storage.deleteObject(version.storageKey);
    await this.audit.recordDelete('BuildingModelVersion', versionId, member);
    this.realtime.emitToOrg(member.organizationId, 'v1:buildingModel:deleted', { versionId });
  }
}
```

(`building-models.mapper.ts` holds `toBuildingModelDto`/`toVersionDto` — pure row→DTO mappers, omitting `storageKey`. The `AuditService`/realtime tokens map to F1a's real providers in the module, Task 4.)

- [ ] **Step 4: Run → PASS.** Commit `feat(api): BuildingModelsService read/activate/delete`.

---

## Task 3: Proxied upload (`uploadVersion`) + e2e against MinIO

**Files:** Modify `building-models.service.ts`; create `building-models.controller.ts` (upload handler); `building-models.e2e.ts`.

- [ ] **Step 1: Implement `uploadVersion`** (append to the service)

```typescript
import { Readable } from 'node:stream';
import { meteredHashingStream, UploadTooLargeError, InvalidIfcError } from './metered-hashing-stream';
import { randomUUID } from 'node:crypto';

async uploadVersion(member: OrganizationMember, propertyId: string, fileName: string, units: string | null, body: Readable): Promise<BuildingModelVersionDto> {
  // 1. property must exist, be in-org, and be a BUILDING
  const property = await this.properties.findById(member.organizationId, propertyId);
  if (!property) throw new NodeScopeException('MODEL_001', 'BUILDING_MODEL_NOT_FOUND', HttpStatus.NOT_FOUND);
  if (property.type !== 'BUILDING') throw new NodeScopeException('MODEL_002', 'PROPERTY_NOT_BUILDING', HttpStatus.UNPROCESSABLE_ENTITY);

  // 2. get-or-create the model (implicit creation; name defaults to the building's name)
  const model = (await this.repo.findByProperty(member.organizationId, propertyId))
    ?? (await this.repo.createModel({ organizationId: member.organizationId, propertyId, name: property.name }));

  // 3. stream body → metered/hashing transform → object store
  const versionId = randomUUID();
  const key = this.storage.buildVersionKey(member.organizationId, propertyId, versionId);
  const maxBytes = parseInt(process.env.MODEL_MAX_BYTES ?? '209715200', 10);
  const { transform, result } = meteredHashingStream(maxBytes);
  body.pipe(transform);
  try {
    await this.storage.putObjectStream(key, transform, 'application/octet-stream');
  } catch (e) {
    await this.storage.deleteObject(key).catch(() => undefined); // clean any partial
    if (e instanceof UploadTooLargeError) throw new NodeScopeException('MODEL_006', 'MODEL_FILE_TOO_LARGE', HttpStatus.PAYLOAD_TOO_LARGE);
    if (e instanceof InvalidIfcError) throw new NodeScopeException('MODEL_007', 'INVALID_IFC_FILE', HttpStatus.UNPROCESSABLE_ENTITY);
    throw e;
  }
  const { contentHash, sizeBytes } = result();

  // 4. record the immutable version + activate
  const versionNumber = await this.repo.nextVersionNumber(member.organizationId, model.id);
  const version = await this.repo.createVersion({
    organizationId: member.organizationId, buildingModelId: model.id, versionNumber,
    storageKey: key, fileName: fileName || 'model.ifc', contentHash, sizeBytes,
    units, uploadedByMemberId: member.id,
  });
  await this.repo.setActiveVersion(member.organizationId, model.id, version.id, model.version);
  await this.audit.recordCreate('BuildingModelVersion', version.id, member);
  this.realtime.emitToOrg(member.organizationId, 'v1:buildingModel:versionUploaded', { propertyId, versionId: version.id, versionNumber });
  return toVersionDto(version);
}
```

> The `Upload` consumes the `transform`; a transform error rejects the `Upload`, landing in the `catch` (which maps `MODEL_006`/`MODEL_007` and deletes the partial object). The version row is written only **after** the object lands (spec §11 orphan mitigation).

- [ ] **Step 2: Controller upload handler** (`building-models.controller.ts`) — raw stream via `@Req()`:

```typescript
@Controller('v1/buildings/:propertyId/model')
export class BuildingModelsController {
  constructor(private readonly service: BuildingModelsService) {}

  @Post('versions')
  @OrgRoles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @OrgMember() member: OrganizationMember,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('fileName') fileName: string,
    @Query('units') units: string | undefined,
    @Req() req: import('express').Request,
  ) {
    const data = await this.service.uploadVersion(member, propertyId, fileName, units ?? null, req);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
```

(Client sends the IFC as the raw request body with `Content-Type: application/octet-stream` + `?fileName=foo.ifc`. The JSON body parser ignores octet-stream, so `req` is the unconsumed `Readable`.)

- [ ] **Step 3: Write the e2e** (`building-models.e2e.ts`, real MinIO) — sign up; seed org + OWNER membership + a `SITE`→`BUILDING`; upload a small valid `.ifc`, assert 201 + a version + active set:

```typescript
it('OWNER uploads an IFC version; it becomes active; download returns identical bytes', async () => {
  const ifc = Buffer.from('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n');
  const up = await request(server)
    .post(`/api/v1/buildings/${buildingId}/model/versions?fileName=test.ifc`)
    .set('Cookie', ownerCookie).set('Content-Type', 'application/octet-stream').send(ifc).expect(201);
  expect(up.body.data.versionNumber).toBe(1);
  const model = await request(server).get(`/api/v1/buildings/${buildingId}/model`).set('Cookie', ownerCookie).expect(200);
  expect(model.body.data.activeVersionId).toBe(up.body.data.id);
});

it('MEMBER upload → 403 ORG_003; non-IFC → 422 MODEL_007; non-BUILDING property → 422 MODEL_002', async () => {
  await request(server).post(`/api/v1/buildings/${buildingId}/model/versions?fileName=x.ifc`)
    .set('Cookie', memberCookie).set('Content-Type', 'application/octet-stream').send(Buffer.from('ISO-10303-21;')).expect(403);
  const bad = await request(server).post(`/api/v1/buildings/${buildingId}/model/versions?fileName=x.ifc`)
    .set('Cookie', ownerCookie).set('Content-Type', 'application/octet-stream').send(Buffer.from('garbage')).expect(422);
  expect(bad.body.error.code).toBe('MODEL_007');
});
```

- [ ] **Step 4: Run → PASS** (MinIO up): `docker compose -f docker-compose.test.yml up -d && cd apps/api && npm run test:e2e -- building-models`.

- [ ] **Step 5: Commit** `feat(api): proxied streaming IFC upload (create+activate version)`.

---

## Task 4: Download + remaining endpoints + module wiring

**Files:** Modify `building-models.controller.ts`, `building-models.module.ts`, `app.module.ts`.

- [ ] **Step 1: Service `getVersionFile`/`getActiveFile`**

```typescript
async getActiveFile(member: OrganizationMember, propertyId: string): Promise<{ stream: Readable; fileName: string }> {
  const model = await this.loadModelOr404(member, propertyId);
  if (!model.activeVersionId) throw new NodeScopeException('MODEL_004', 'MODEL_VERSION_NOT_FOUND', HttpStatus.NOT_FOUND);
  const version = await this.repo.findVersion(member.organizationId, model.activeVersionId);
  if (!version) throw new NodeScopeException('MODEL_004', 'MODEL_VERSION_NOT_FOUND', HttpStatus.NOT_FOUND);
  return { stream: await this.storage.getObjectStream(version.storageKey), fileName: version.fileName };
}
```

(`getVersionFile(member, propertyId, versionId)` mirrors this but loads the given version and checks it belongs to the model → `MODEL_004`.)

- [ ] **Step 2: Controller** — list/get/activate/download/delete handlers:

```typescript
@Get()
async getModel(@OrgMember() m: OrganizationMember, @Param('propertyId', ParseUUIDPipe) p: string) {
  return { success: true, data: await this.service.getModel(m, p), timestamp: new Date().toISOString() };
}

@Get('versions')
async listVersions(@OrgMember() m: OrganizationMember, @Param('propertyId', ParseUUIDPipe) p: string) {
  return { success: true, data: await this.service.listVersions(m, p), timestamp: new Date().toISOString() };
}

@Put('active')
@OrgRoles('OWNER', 'ADMIN')
async activate(@OrgMember() m: OrganizationMember, @Param('propertyId', ParseUUIDPipe) p: string, @Body() dto: ActivateVersionDto) {
  return { success: true, data: await this.service.activateVersion(m, p, dto.versionId), timestamp: new Date().toISOString() };
}

@Get('active/file')
async downloadActive(@OrgMember() m: OrganizationMember, @Param('propertyId', ParseUUIDPipe) p: string): Promise<StreamableFile> {
  const { stream, fileName } = await this.service.getActiveFile(m, p);
  return new StreamableFile(stream, { type: 'application/octet-stream', disposition: `attachment; filename="${fileName}"` });
}

@Delete('versions/:versionId')
@OrgRoles('OWNER', 'ADMIN')
@HttpCode(HttpStatus.NO_CONTENT)
async deleteVersion(@OrgMember() m: OrganizationMember, @Param('propertyId', ParseUUIDPipe) p: string, @Param('versionId', ParseUUIDPipe) v: string) {
  await this.service.deleteVersion(m, p, v);
}
```

(`ActivateVersionDto { @IsString() versionId: string }` in `building-models.dto.ts`. Add `@Get('versions/:versionId/file')` mirroring `downloadActive`.)

- [ ] **Step 3: `building-models.module.ts`** — wire deps; map the `'AuditService'`/`'REALTIME_ORG_EMITTER'` tokens to F1a's real providers:

```typescript
@Module({
  imports: [PrismaModule, StorageModule, PropertiesModule, AuditModule, RealtimeModule],
  controllers: [BuildingModelsController],
  providers: [
    BuildingModelsService, BuildingModelsRepository,
    { provide: 'AuditService', useExisting: AuditService },
    { provide: 'REALTIME_ORG_EMITTER', useFactory: (rt: RealtimeGateway) => ({ emitToOrg: (org, e, p) => rt.pushToOrg(org, e, p) }), inject: [RealtimeGateway] },
  ],
  exports: [BuildingModelsRepository, BuildingModelsService],
})
export class BuildingModelsModule {}
```

Add `BuildingModelsModule` to `AppModule.imports`. (`pushToOrg` is F1a's realtime org-room emit; if F1a named it differently, adapt the factory.)

- [ ] **Step 4: e2e** — add download-identical-bytes, activate/rollback (upload v2, `PUT active` back to v1), and delete-active→`MODEL_005` / delete-non-active→204 cases. Run → PASS.

- [ ] **Step 5: Commit** `feat(api): building-model download + activate/rollback/delete endpoints`.

---

## Task 5: Property delete-block extension (`MODEL_008`)

**Files:** Modify `apps/api/src/properties/properties.service.ts` (F2); extend properties e2e.

- [ ] **Step 1: Write the failing e2e** — a `BUILDING` with a model can't be deleted:

```typescript
it('deleting a BUILDING that has a model is blocked with MODEL_008', async () => {
  // upload a model to buildingId first, then:
  const res = await request(server).delete(`/api/v1/properties/${buildingId}`).set('Cookie', ownerCookie).expect(409);
  expect(res.body.error.code).toBe('MODEL_008');
});
```

- [ ] **Step 2: Extend `deleteProperty`** — before/alongside F2's children/devices/charters check, reject if a `BuildingModel` exists for the property:

```typescript
if (await this.buildingModels.findByProperty(organizationId, id)) {
  throw new NodeScopeException('MODEL_008', 'BUILDING_HAS_MODEL', HttpStatus.CONFLICT);
}
```

Inject `BuildingModelsRepository` into `PropertiesService` (import `BuildingModelsModule`; mind the module cycle — `PropertiesModule` is imported by `BuildingModelsModule`, so use `forwardRef` on the back-reference, or move `findByProperty` access behind a small exported provider).

- [ ] **Step 3: Run → PASS.** Commit `feat(api): block BUILDING delete when a model exists (MODEL_008)`.

---

## Task 6: Phase gate

- [ ] **Step 1: Full suite** (infra up): `docker compose -f docker-compose.test.yml up -d`, then `cd apps/api && npm run test:unit && npm run test:integration && npm run test:e2e` → green.
- [ ] **Step 2: Docs (Rule 10).** Register the `/v1/buildings/:propertyId/model*` endpoints + `v1:buildingModel:*` events in the API Design Document; update the SAD with the proxied-transfer flow.
- [ ] **Step 3: Commit** `docs: Spec 1 building-model API + proxied transfer (Phase B)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** upload → new version → activate (§5, §7) ✓ Task 3; proxied streaming with size cap/`MODEL_006`, IFC magic/`MODEL_007`, content-hash (§7) ✓ Tasks 1, 3; download streaming (§7) ✓ Task 4; activate/rollback (§5) ✓ Task 4; delete non-active + object, block active/`MODEL_005` (§5) ✓ Tasks 2, 4; `BUILDING`-only/`MODEL_002`, implicit create (§5, §8) ✓ Task 3; OWNER/ADMIN + `ORG_003` (§8) ✓ Tasks 3–4; audit + `v1:buildingModel:*` (§8) ✓ Tasks 2–4; `MODEL_008` property-delete block (§4.4/§10.3) ✓ Task 5; orphan mitigation (row after object) (§11) ✓ Task 3.
- **Deferred (correctly NOT here):** `Device.x/y/z` position endpoint + building-resolution + clear-on-move → Phase C.
- **Placeholder scan:** none; the one mapper (`building-models.mapper.ts`) is specified (pure row→DTO, omit `storageKey`).
- **Type consistency:** `uploadVersion(member, propertyId, fileName, units, body)`, `getActiveFile`, `activateVersion`, `deleteVersion` match controller calls; `meteredHashingStream` returns `{ transform, result() => { contentHash, sizeBytes } }` consumed verbatim; DTO mappers omit `storageKey` per §10.1.
- **Test-config compliance:** stream validator → `*.validator.spec.ts` (unit); service → `*.service.spec.ts` (unit); HTTP + MinIO → `*.e2e.ts` (e2e).
- **Integration points to verify during execution:** F1a `@OrgMember()`/`@OrgRoles`/`AuditService.recordCreate/recordDelete`/realtime `pushToOrg` exact names; F2 `PropertiesService.findById(org, id)` returning `{ type }`; that octet-stream bodies aren't consumed by a global body parser in `main.ts` (and no global body-size limit clips uploads — configure the route raw if needed); the `PropertiesModule` ↔ `BuildingModelsModule` cycle (`forwardRef`).
