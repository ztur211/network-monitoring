# Spec 6 Phase C — Export, CRUD & Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Round out the BCF server: export a building's topics to `.bcfzip`, the topic/comment CRUD service, and the F3-scoped `/v1/.../bcf/*` endpoints (reads + export open to in-scope members; import/author/comment/status require OWNER/ADMIN).

**Architecture:** `BcfExportService` loads the building's in-scope topics (+ comments/viewpoints/snapshots from `StorageService`), maps to `ParsedTopic[]`, and calls `writeBcfZip` (Phase A). `BcfService` does list/get/author/patch/comment with F3 (`inScope` for reads, `assertCanConfigure` for mutations). `BcfController` wires import (→ Phase B), export, and CRUD.

**Tech Stack:** NestJS, Prisma, Jest (integration + e2e).

**Depends on:** Phase A (`writeBcfZip`/`ParsedTopic`), Phase B (`BcfImportService`, `deriveDeviceLinks`), Spec 1 (`StorageService`), F3 (`PermissionsService`), Spec 5 (`toIfcGuid`). Spec: `2026-06-12-spec6-bcf-design.md` (§8).

---

## File Structure

**Create:** `apps/api/src/bcf/{bcf-export.service.ts, bcf.service.ts, bcf.controller.ts, bcf.module.ts}`; `packages/shared/src/types/bcf.types.ts`; tests `bcf/__tests__/{bcf-export.service.spec.ts, bcf.controller.e2e.ts}`.

---

## Task 1: Shared DTOs

- [ ] **Step 1: `bcf.types.ts`:**
```typescript
export interface BcfCommentDto { id: string; guid: string; comment: string; author: string; date: string; viewpointGuid: string | null }
export interface BcfViewpointDto { id: string; guid: string; camera: unknown; components: unknown; hasSnapshot: boolean; isPrimary: boolean }
export interface BcfTopicDto { id: string; guid: string; title: string; topicType: string | null; topicStatus: string | null; priority: string | null; assignedTo: string | null; creationAuthor: string; creationDate: string; deviceIds: string[]; comments: BcfCommentDto[]; viewpoints: BcfViewpointDto[]; version: number }
export interface CreateBcfTopicDto { title: string; topicType?: string; priority?: string; description?: string; assignedTo?: string;
  viewpoint?: { camera: unknown; components: { selection: string[]; visibility: { defaultVisibility: boolean; exceptions: string[] } }; snapshotBase64?: string } }
export interface AddBcfCommentDto { comment: string; viewpointGuid?: string }
export interface PatchBcfTopicDto { topicStatus?: string; assignedTo?: string; priority?: string; baseVersion: number }
```
`cd packages/shared && npm run build`.

---

## Task 2: `BcfExportService` (Jest integration)

**Files:** Create `bcf-export.service.ts`; test `bcf/__tests__/bcf-export.service.spec.ts`.

- [ ] **Step 1: Failing test** — a building's topics export to a re-readable `.bcfzip`:
```typescript
it('exports the building topics to a re-readable .bcfzip', async () => {
  await prisma.bcfTopic.create({ data: { organizationId: orgId, propertyId: buildingId, guid: 'T1', title: 'Issue', labels: [], creationAuthor: 'a', creationDate: new Date('2026-06-12T00:00:00Z'),
    viewpoints: { create: { organizationId: orgId, guid: 'V1', isPrimary: true, camera: { kind: 'perspective', position: [1,2,3], direction: [0,0,-1], up: [0,1,0], fieldOfView: 60 }, components: { selection: ['G1'], visibility: { defaultVisibility: true, exceptions: [] } }, clippingPlanes: [] } } } });
  const buf = await svc.exportBcf(orgId, owner, buildingId);
  const parsed = await readBcfZip(buf);
  expect(parsed.topics[0]).toMatchObject({ guid: 'T1', title: 'Issue' });
  expect(parsed.topics[0].viewpoints[0].camera.position).toEqual([1, 2, 3]);
});
```

- [ ] **Step 2: Run → FAIL**, then implement `bcf-export.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../permissions/permissions.service';
import { StorageService } from '../storage/storage.service';
import { NodeScopeException } from '../common/errors/nodescope.exception';
import { writeBcfZip, ParsedTopic } from './bcf-zip';
import type { Member } from '../common/types';

async function streamToBuffer(s: NodeJS.ReadableStream): Promise<Buffer> { const chunks: Buffer[] = []; for await (const c of s) chunks.push(c as Buffer); return Buffer.concat(chunks); }

@Injectable()
export class BcfExportService {
  constructor(private readonly prisma: PrismaService, private readonly permissions: PermissionsService, private readonly storage: StorageService) {}

  async exportBcf(orgId: string, member: Member, buildingPropertyId: string): Promise<Buffer> {
    if (member.role !== 'OWNER' && !(await this.permissions.inScope(member.id, buildingPropertyId))) throw new NodeScopeException('BCF_404', 'Building not found', 404);
    const topics = await this.prisma.bcfTopic.findMany({ where: { organizationId: orgId, propertyId: buildingPropertyId }, include: { comments: true, viewpoints: true } });
    const out: ParsedTopic[] = [];
    for (const t of topics) {
      const viewpoints = [];
      for (const v of t.viewpoints) {
        const snapshotPng = v.snapshotKey ? await streamToBuffer(await this.storage.getObjectStream(v.snapshotKey)) : undefined;
        viewpoints.push({ guid: v.guid, isPrimary: v.isPrimary, camera: v.camera as any, components: v.components as any, clippingPlanes: v.clippingPlanes as any, snapshotPng });
      }
      out.push({ guid: t.guid, title: t.title, topicType: t.topicType ?? undefined, topicStatus: t.topicStatus ?? undefined, priority: t.priority ?? undefined, labels: t.labels,
        creationAuthor: t.creationAuthor, creationDate: t.creationDate.toISOString(), assignedTo: t.assignedTo ?? undefined, description: t.description ?? undefined,
        comments: t.comments.map((c) => ({ guid: c.guid, comment: c.comment, author: c.author, date: c.date.toISOString(), viewpointGuid: c.viewpointGuid ?? undefined })), viewpoints });
    }
    return writeBcfZip(out);
  }
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(api): BCF export (.bcfzip)`.

---

## Task 3: `BcfService` CRUD (Jest integration)

**Files:** Create `bcf.service.ts`; test `bcf/__tests__/bcf.service.spec.ts`.

- [ ] **Step 1: Failing test** — list (scope), author (ADMIN+), comment, patch with optimistic version:
```typescript
it('lists, authors a topic (with a viewpoint + device link), comments, patches status', async () => {
  const created = await svc.createTopic(orgId, owner, buildingId, { title: 'New', viewpoint: { camera: { kind: 'perspective', position: [0,0,0], direction: [0,0,-1], up: [0,1,0] },
    components: { selection: [toIfcGuid(deviceId)], visibility: { defaultVisibility: true, exceptions: [] } } } });
  expect(created.deviceIds).toEqual([deviceId]);
  await svc.addComment(orgId, owner, created.id, { comment: 'hi' });
  const patched = await svc.patchTopic(orgId, owner, created.id, { topicStatus: 'Closed', baseVersion: created.version });
  expect(patched.topicStatus).toBe('Closed');
  const list = await svc.listTopics(orgId, owner, buildingId);
  expect(list.find((t) => t.id === created.id)!.comments).toHaveLength(1);
});
```

- [ ] **Step 2: Run → FAIL**, then implement `bcf.service.ts` (key methods):
```typescript
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { BcfTopicDto, CreateBcfTopicDto, AddBcfCommentDto, PatchBcfTopicDto } from '@nodescope/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PropertiesService } from '../properties/properties.service';
import { StorageService } from '../storage/storage.service';
import { NodeScopeException } from '../common/errors/nodescope.exception';
import { toIfcGuid } from '../export/ifc-guid';
import { deriveDeviceLinks } from './device-links';
import type { Member } from '../common/types';

@Injectable()
export class BcfService {
  constructor(private readonly prisma: PrismaService, private readonly permissions: PermissionsService, private readonly properties: PropertiesService, private readonly storage: StorageService) {}

  private async assertView(member: Member, buildingId: string) { if (member.role !== 'OWNER' && !(await this.permissions.inScope(member.id, buildingId))) throw new NodeScopeException('BCF_404', 'Building not found', 404); }
  private toDto = (t: any): BcfTopicDto => ({ id: t.id, guid: t.guid, title: t.title, topicType: t.topicType, topicStatus: t.topicStatus, priority: t.priority, assignedTo: t.assignedTo,
    creationAuthor: t.creationAuthor, creationDate: t.creationDate.toISOString(), version: t.version, deviceIds: (t.devices ?? []).map((d: any) => d.deviceId),
    comments: (t.comments ?? []).map((c: any) => ({ id: c.id, guid: c.guid, comment: c.comment, author: c.author, date: c.date.toISOString(), viewpointGuid: c.viewpointGuid })),
    viewpoints: (t.viewpoints ?? []).map((v: any) => ({ id: v.id, guid: v.guid, camera: v.camera, components: v.components, hasSnapshot: !!v.snapshotKey, isPrimary: v.isPrimary })) });
  private include = { comments: true, viewpoints: true, devices: true };

  async listTopics(orgId: string, member: Member, buildingId: string): Promise<BcfTopicDto[]> {
    await this.assertView(member, buildingId);
    return (await this.prisma.bcfTopic.findMany({ where: { organizationId: orgId, propertyId: buildingId }, include: this.include, orderBy: { createdAt: 'desc' } })).map(this.toDto);
  }

  async createTopic(orgId: string, member: Member, buildingId: string, d: CreateBcfTopicDto): Promise<BcfTopicDto> {
    await this.permissions.assertCanConfigure(member, { type: 'Property', id: buildingId });
    const subtree = await this.properties.subtreePropertyIds(orgId, buildingId);
    const devs = await this.prisma.device.findMany({ where: { organizationId: orgId, propertyId: { in: subtree } }, select: { id: true } });
    const guidMap = new Map(devs.map((x) => [toIfcGuid(x.id), x.id]));
    const topic = await this.prisma.bcfTopic.create({ data: { organizationId: orgId, propertyId: buildingId, guid: randomUUID(), title: d.title, topicType: d.topicType ?? null, priority: d.priority ?? null,
      description: d.description ?? null, assignedTo: d.assignedTo ?? null, topicStatus: 'Open', creationAuthor: member.id, creationDate: new Date() } });
    if (d.viewpoint) {
      let snapshotKey: string | null = null;
      if (d.viewpoint.snapshotBase64) { snapshotKey = `bcf/${orgId}/${topic.guid}/${randomUUID()}.png`; await this.storage.putObjectStream(snapshotKey, Readable.from(Buffer.from(d.viewpoint.snapshotBase64, 'base64')), 'image/png'); }
      await this.prisma.bcfViewpoint.create({ data: { organizationId: orgId, topicId: topic.id, guid: randomUUID(), camera: d.viewpoint.camera as object, components: d.viewpoint.components as object, clippingPlanes: [], snapshotKey, isPrimary: true } });
      const guids = [...d.viewpoint.components.selection, ...d.viewpoint.components.visibility.exceptions];
      for (const deviceId of deriveDeviceLinks(guids, guidMap)) await this.prisma.bcfTopicDevice.create({ data: { topicId: topic.id, deviceId } });
    }
    return this.toDto(await this.prisma.bcfTopic.findUnique({ where: { id: topic.id }, include: this.include }));
  }

  async addComment(orgId: string, member: Member, topicId: string, d: AddBcfCommentDto): Promise<void> {
    const topic = await this.prisma.bcfTopic.findFirst({ where: { id: topicId, organizationId: orgId } });
    if (!topic) throw new NodeScopeException('BCF_404', 'Topic not found', 404);
    await this.permissions.assertCanConfigure(member, { type: 'Property', id: topic.propertyId });
    await this.prisma.bcfComment.create({ data: { organizationId: orgId, topicId, guid: randomUUID(), comment: d.comment, author: member.id, date: new Date(), viewpointGuid: d.viewpointGuid ?? null } });
  }

  async patchTopic(orgId: string, member: Member, topicId: string, d: PatchBcfTopicDto): Promise<BcfTopicDto> {
    const topic = await this.prisma.bcfTopic.findFirst({ where: { id: topicId, organizationId: orgId } });
    if (!topic) throw new NodeScopeException('BCF_404', 'Topic not found', 404);
    await this.permissions.assertCanConfigure(member, { type: 'Property', id: topic.propertyId });
    const r = await this.prisma.bcfTopic.updateMany({ where: { id: topicId, version: d.baseVersion }, data: { topicStatus: d.topicStatus, assignedTo: d.assignedTo, priority: d.priority, modifiedAuthor: member.id, modifiedDate: new Date(), version: { increment: 1 } } });
    if (r.count === 0) throw new NodeScopeException('ORG_CONFLICT', 'Version conflict', 409);
    return this.toDto(await this.prisma.bcfTopic.findUnique({ where: { id: topicId }, include: this.include }));
  }
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(api): BCF topic/comment CRUD`.

---

## Task 4: `BcfController` + module (Jest e2e)

**Files:** Create `bcf.controller.ts`, `bcf.module.ts`; test `bcf/__tests__/bcf.controller.e2e.ts`.

- [ ] **Step 1: Failing e2e** — import/export/CRUD + F3 (MEMBER reads+exports, can't mutate):
```typescript
it('round-trips import/export and gates mutations by F3', async () => {
  await request(srv).post(`/v1/buildings/${buildingId}/bcf/import`).set(ownerAuth).attach('file', sampleBcfzip, 'in.bcfzip').expect(201);
  const list = (await request(srv).get(`/v1/buildings/${buildingId}/bcf/topics`).set(memberInScopeAuth).expect(200)).body.data;
  expect(list.length).toBeGreaterThan(0);
  const exp = await request(srv).get(`/v1/buildings/${buildingId}/bcf/export`).set(memberInScopeAuth).expect(200);
  expect(exp.headers['content-type']).toContain('application/octet-stream');
  await request(srv).post(`/v1/buildings/${buildingId}/bcf/topics`).set(memberInScopeAuth).send({ title: 'x' }).expect(403); // MEMBER cannot author
});
```

- [ ] **Step 2: Run → FAIL**, then implement `bcf.controller.ts`:
```typescript
@Controller('v1')
export class BcfController {
  constructor(private readonly bcf: BcfService, private readonly importSvc: BcfImportService, private readonly exportSvc: BcfExportService) {}

  @Post('buildings/:propertyId/bcf/import') @UseInterceptors(FileInterceptor('file'))
  import(@OrgId() o: string, @CurrentMember() m: Member, @Param('propertyId') id: string, @UploadedFile() file: { buffer: Buffer }) {
    return this.importSvc.importBcf(o, m, id, file.buffer);
  }
  @Get('buildings/:propertyId/bcf/export')
  async export(@OrgId() o: string, @CurrentMember() m: Member, @Param('propertyId') id: string, @Res() res: Response) {
    const buf = await this.exportSvc.exportBcf(o, m, id);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${id}-issues.bcfzip"`);
    res.send(buf);
  }
  @Get('buildings/:propertyId/bcf/topics') list(@OrgId() o: string, @CurrentMember() m: Member, @Param('propertyId') id: string) { return this.bcf.listTopics(o, m, id); }
  @Post('buildings/:propertyId/bcf/topics') create(@OrgId() o: string, @CurrentMember() m: Member, @Param('propertyId') id: string, @Body() b: CreateBcfTopicDto) { return this.bcf.createTopic(o, m, id, b); }
  @Patch('bcf/topics/:id') patch(@OrgId() o: string, @CurrentMember() m: Member, @Param('id') id: string, @Body() b: PatchBcfTopicDto) { return this.bcf.patchTopic(o, m, id, b); }
  @Post('bcf/topics/:id/comments') comment(@OrgId() o: string, @CurrentMember() m: Member, @Param('id') id: string, @Body() b: AddBcfCommentDto) { return this.bcf.addComment(o, m, id, b); }
}
```
`bcf.module.ts` imports `StorageModule` + `PropertiesModule` + `PermissionsModule`, provides `BcfService`/`BcfImportService`/`BcfExportService`, registers `BcfController`. Wire into the app.

- [ ] **Step 3: Run → PASS.** Commit `feat(api): BCF endpoints (import/export/topics/comments)`.

---

## Task 5: Phase gate

- [ ] **Step 1: Suites.** `cd apps/api && npm run test:integration -- bcf && npm run test:e2e -- bcf` → green; `npx tsc --noEmit` → PASS.
- [ ] **Step 2: Docs (Rule 10).** API Design Document: the `/v1/.../bcf/*` endpoints (auth + scope). SAD/CLAUDE.md: BCF round-trip server.
- [ ] **Step 3: Commit** `docs: record Spec 6 BCF export + CRUD + endpoints (Phase C)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** export `.bcfzip` (§6, §8) ✓ Task 2; topic list/get/author/patch + comment (§8) ✓ Task 3; endpoints incl. multipart import (§8) ✓ Task 4; F3 — reads + export open to in-scope members, mutations OWNER/ADMIN (§8) ✓ Tasks 2–4; create-from-view payload incl. snapshot + device links (§8, §9) ✓ Task 3.
- **Deferred (correctly NOT here):** the desktop `ParsedModel.guidIndex` + `apply-viewpoint`/`capture-viewpoint` (Phase D); the Issues panel + realtime (Phase E).
- **Placeholder scan:** none — complete code/commands.
- **Type consistency:** `BcfTopicDto`/`CreateBcfTopicDto`/`AddBcfCommentDto`/`PatchBcfTopicDto` (shared) ↔ service ↔ controller; `writeBcfZip`/`ParsedTopic` (Phase A); `BcfImportService.importBcf` (Phase B); `deriveDeviceLinks` + `toIfcGuid`; `StorageService.getObjectStream`/`putObjectStream` (Spec 1); F3 `inScope`/`assertCanConfigure`.
- **Test-config compliance:** export/CRUD integration (test DB + MinIO or a mocked `StorageService`); controller e2e (OWNER + in-/out-of-scope MEMBER auth, multipart upload, `@Res()` raw download).
- **Integration points to verify during execution:** `FileInterceptor`/multipart setup in the API; the optimistic-version conflict code (`ORG_CONFLICT` here — match F1a's actual code); `@Res()` bypasses the JSON envelope for both export routes; F3 `inScope`/`assertCanConfigure` signatures.
