# Spec 6 Phase A — BCF Models & .bcfzip Codec Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The BCF data model (`BcfTopic`/`BcfComment`/`BcfViewpoint`/`BcfTopicDevice`) + a pure, dependency-light **BCF 2.1 `.bcfzip` reader/writer** that losslessly round-trips topics, comments, and viewpoints (camera + components + snapshot).

**Architecture:** Prisma models follow F1a conventions (org-scoped, `version`, audit). `bcf-zip.ts` wraps `jszip` (the archive) + `fast-xml-parser` (markup/viewpoint XML) behind `readBcfZip(buffer) → ParsedBcf` / `writeBcfZip(topics) → Buffer` — pure, round-trip-tested. No DB/HTTP here.

**Tech Stack:** NestJS 11, Prisma 5, `jszip`, `fast-xml-parser`, Jest (unit + integration).

**Depends on:** **F1a** (`Organization`, `ChangeLog`, `PrismaService`); **F2** (the `BUILDING` `Property`). Spec: `docs/superpowers/specs/2026-06-12-spec6-bcf-design.md` (§5, §6).

> Import (Phase B), export + CRUD + endpoints (Phase C), and the desktop viewport (Phases D–E) build on this.

---

## File Structure

**Create:**
- `apps/api/src/bcf/bcf-zip.ts` — `readBcfZip` / `writeBcfZip` + the `ParsedBcf` types
- tests `apps/api/src/bcf/__tests__/bcf-zip.spec.ts`

**Modify:**
- `apps/api/prisma/schema.prisma` — the 4 models + migration + `ChangeLog` CHECK
- `apps/api/package.json` — add `jszip`, `fast-xml-parser`

---

## Task 1: Models + migration

- [ ] **Step 1: Prisma** (spec §5):
```prisma
model BcfTopic {
  id String @id @default(uuid())
  organizationId String
  propertyId String                 // the BUILDING (governingSiteId for F3)
  guid String
  title String
  topicType String?  topicStatus String?  priority String?
  labels String[]    @default([])
  creationAuthor String  creationDate DateTime
  modifiedAuthor String?  modifiedDate DateTime?
  assignedTo String?  dueDate DateTime?  description String?
  version Int @default(1)
  createdAt DateTime @default(now())  updatedAt DateTime @updatedAt
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  comments BcfComment[]  viewpoints BcfViewpoint[]  devices BcfTopicDevice[]
  @@unique([organizationId, guid])
  @@index([organizationId, propertyId])
}
model BcfComment {
  id String @id @default(uuid())  organizationId String  topicId String
  guid String  comment String  author String  date DateTime  viewpointGuid String?
  topic BcfTopic @relation(fields: [topicId], references: [id], onDelete: Cascade)
  @@index([topicId])
}
model BcfViewpoint {
  id String @id @default(uuid())  organizationId String  topicId String
  guid String  camera Json  components Json  clippingPlanes Json  snapshotKey String?  isPrimary Boolean @default(false)
  topic BcfTopic @relation(fields: [topicId], references: [id], onDelete: Cascade)
  @@index([topicId])
}
model BcfTopicDevice {
  id String @id @default(uuid())  topicId String  deviceId String
  topic BcfTopic @relation(fields: [topicId], references: [id], onDelete: Cascade)
  @@unique([topicId, deviceId])  @@index([deviceId])
}
```
Add `bcfTopics BcfTopic[]` to `Organization`.

- [ ] **Step 2: Migrate.** `cd apps/api && npm i jszip fast-xml-parser && npx prisma migrate dev --name spec6_bcf`. Append the `ChangeLog` CHECK extension adding `'BcfTopic'`,`'BcfComment'`. `npx prisma migrate reset --force`; `npx tsc --noEmit` → PASS. Commit `feat(api): BCF topic/comment/viewpoint models`.

---

## Task 2: `.bcfzip` reader/writer (Jest unit, round-trip)

**Files:** Create `bcf/bcf-zip.ts`; test `bcf/__tests__/bcf-zip.spec.ts`.

- [ ] **Step 1: Failing round-trip test:**
```typescript
import { readBcfZip, writeBcfZip, ParsedTopic } from '../bcf-zip';

const topic: ParsedTopic = {
  guid: 'c2c0e1a0-0000-0000-0000-000000000001', title: 'Clash at riser', topicType: 'Clash', topicStatus: 'Open',
  priority: 'High', labels: ['MEP'], creationAuthor: 'arch@x.com', creationDate: '2026-06-12T00:00:00Z', assignedTo: 'net@x.com', description: 'Switch overlaps duct',
  comments: [{ guid: 'cmt0', comment: 'Please move', author: 'arch@x.com', date: '2026-06-12T01:00:00Z', viewpointGuid: 'vp0' }],
  viewpoints: [{ guid: 'vp0', isPrimary: true, camera: { kind: 'perspective', position: [1, 2, 3], direction: [0, 0, -1], up: [0, 1, 0], fieldOfView: 60 },
    components: { selection: ['1aBcD$...'], visibility: { defaultVisibility: true, exceptions: [] } }, clippingPlanes: [] }],
};

describe('bcf-zip', () => {
  it('writes a .bcfzip and reads it back losslessly', async () => {
    const buf = await writeBcfZip([topic]);
    const parsed = await readBcfZip(buf);
    expect(parsed.topics).toHaveLength(1);
    const t = parsed.topics[0];
    expect(t).toMatchObject({ guid: topic.guid, title: 'Clash at riser', topicStatus: 'Open' });
    expect(t.comments[0].comment).toBe('Please move');
    expect(t.viewpoints[0].camera.position).toEqual([1, 2, 3]);
    expect(t.viewpoints[0].components.selection).toEqual(['1aBcD$...']);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:unit -- bcf-zip`.

- [ ] **Step 3: Implement `bcf-zip.ts`:**
```typescript
import JSZip from 'jszip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

export interface BcfCamera { kind: 'perspective' | 'orthographic'; position: [number, number, number]; direction: [number, number, number]; up: [number, number, number]; fieldOfView?: number; viewToWorldScale?: number; }
export interface BcfComponents { selection: string[]; visibility: { defaultVisibility: boolean; exceptions: string[] }; }
export interface ParsedViewpoint { guid: string; isPrimary: boolean; camera: BcfCamera; components: BcfComponents; clippingPlanes: unknown[]; snapshotPng?: Buffer; }
export interface ParsedComment { guid: string; comment: string; author: string; date: string; viewpointGuid?: string; }
export interface ParsedTopic { guid: string; title: string; topicType?: string; topicStatus?: string; priority?: string; labels: string[]; creationAuthor: string; creationDate: string; assignedTo?: string; description?: string; comments: ParsedComment[]; viewpoints: ParsedViewpoint[]; }
export interface ParsedBcf { topics: ParsedTopic[]; }

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const build = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true });
const arr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const xyz = (n: { X: number; Y: number; Z: number }): [number, number, number] => [Number(n.X), Number(n.Y), Number(n.Z)];
const pt = ([x, y, z]: number[]) => ({ X: x, Y: y, Z: z });

export async function readBcfZip(buffer: Buffer): Promise<ParsedBcf> {
  const zip = await JSZip.loadAsync(buffer);
  const topics: ParsedTopic[] = [];
  const guids = new Set<string>();
  for (const path of Object.keys(zip.files)) { const m = /^([^/]+)\/markup\.bcf$/.exec(path); if (m) guids.add(m[1]); }
  for (const guid of guids) {
    const markup = xml.parse(await zip.file(`${guid}/markup.bcf`)!.async('string')).Markup;
    const T = markup.Topic;
    const vpFile = zip.file(`${guid}/viewpoint.bcfv`);
    const viewpoints: ParsedViewpoint[] = [];
    if (vpFile) {
      const vi = xml.parse(await vpFile.async('string')).VisualizationInfo;
      const cam = vi.PerspectiveCamera ?? vi.OrthogonalCamera;
      const snap = zip.file(`${guid}/snapshot.png`);
      viewpoints.push({
        guid: vi['@_Guid'] ?? `${guid}-vp`, isPrimary: true,
        camera: { kind: vi.PerspectiveCamera ? 'perspective' : 'orthographic', position: xyz(cam.CameraViewPoint), direction: xyz(cam.CameraDirection), up: xyz(cam.CameraUpVector),
          fieldOfView: cam.FieldOfView != null ? Number(cam.FieldOfView) : undefined, viewToWorldScale: cam.ViewToWorldScale != null ? Number(cam.ViewToWorldScale) : undefined },
        components: { selection: arr(vi.Components?.Selection?.Component).map((c: any) => c['@_IfcGuid']),
          visibility: { defaultVisibility: vi.Components?.Visibility?.['@_DefaultVisibility'] !== 'false', exceptions: arr(vi.Components?.Visibility?.Exceptions?.Component).map((c: any) => c['@_IfcGuid']) } },
        clippingPlanes: arr(vi.ClippingPlanes?.ClippingPlane),
        snapshotPng: snap ? await snap.async('nodebuffer') : undefined,
      });
    }
    topics.push({
      guid, title: T.Title, topicType: T['@_TopicType'], topicStatus: T['@_TopicStatus'], priority: T.Priority, labels: arr(T.Labels),
      creationAuthor: T.CreationAuthor, creationDate: T.CreationDate, assignedTo: T.AssignedTo, description: T.Description,
      comments: arr(markup.Comment).map((c: any) => ({ guid: c['@_Guid'], comment: c.Comment, author: c.Author, date: c.Date, viewpointGuid: c.Viewpoint?.['@_Guid'] })),
      viewpoints,
    });
  }
  return { topics };
}

export async function writeBcfZip(topics: ParsedTopic[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('bcf.version', build.build({ Version: { '@_VersionId': '2.1', DetailedVersion: '2.1' } }));
  for (const t of topics) {
    const markup = { Markup: { Topic: { '@_Guid': t.guid, '@_TopicType': t.topicType, '@_TopicStatus': t.topicStatus, Title: t.title, Priority: t.priority, CreationDate: t.creationDate, CreationAuthor: t.creationAuthor, AssignedTo: t.assignedTo, Description: t.description, Labels: t.labels },
      Comment: t.comments.map((c) => ({ '@_Guid': c.guid, Date: c.date, Author: c.author, Comment: c.comment, Viewpoint: c.viewpointGuid ? { '@_Guid': c.viewpointGuid } : undefined })) } };
    zip.file(`${t.guid}/markup.bcf`, build.build(markup));
    const vp = t.viewpoints[0];
    if (vp) {
      const camTag = vp.camera.kind === 'perspective' ? 'PerspectiveCamera' : 'OrthogonalCamera';
      const vi = { VisualizationInfo: { '@_Guid': vp.guid,
        Components: { Selection: { Component: vp.components.selection.map((g) => ({ '@_IfcGuid': g })) },
          Visibility: { '@_DefaultVisibility': String(vp.components.visibility.defaultVisibility), Exceptions: { Component: vp.components.visibility.exceptions.map((g) => ({ '@_IfcGuid': g })) } } },
        [camTag]: { CameraViewPoint: pt(vp.camera.position), CameraDirection: pt(vp.camera.direction), CameraUpVector: pt(vp.camera.up),
          ...(vp.camera.fieldOfView != null ? { FieldOfView: vp.camera.fieldOfView } : {}), ...(vp.camera.viewToWorldScale != null ? { ViewToWorldScale: vp.camera.viewToWorldScale } : {}) } } };
      zip.file(`${t.guid}/viewpoint.bcfv`, build.build(vi));
      if (vp.snapshotPng) zip.file(`${t.guid}/snapshot.png`, vp.snapshotPng);
    }
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}
```
*(Covers the BCF 2.1 core — topic, comments, one primary viewpoint with camera + components + snapshot. Full optional-field/unknown-XML passthrough and real-tool interop are refined + verified manually during implementation, per spec §13.)*

- [ ] **Step 4: Run → PASS.** Commit `feat(api): BCF 2.1 .bcfzip reader/writer (round-trip)`.

---

## Task 3: Phase gate

- [ ] **Step 1: Suites.** `cd apps/api && npm run test:unit -- bcf-zip` → green; `npx tsc --noEmit` → PASS.
- [ ] **Step 2: Docs (Rule 10).** API Design Document: register the `BcfTopic`/`BcfComment` entities. SAD: the BCF model + the `.bcfzip` codec.
- [ ] **Step 3: Commit** `docs: record Spec 6 BCF models + codec (Phase A)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** `BcfTopic`/`Comment`/`Viewpoint`/`TopicDevice` (§5) ✓ Task 1; `@@unique([organizationId, guid])` re-import dedupe (§5) ✓ Task 1; `.bcfzip` BCF 2.1 read/write round-trip (§6) ✓ Task 2; camera + components + snapshot (§5, §6) ✓ Task 2.
- **Deferred (correctly NOT here):** import service + device links + snapshot storage (Phase B); export + CRUD + endpoints + F3 (Phase C); desktop (D–E). Full unknown-XML passthrough is a stated refinement.
- **Placeholder scan:** none — complete code. The codec covers the core path; tool interop is a documented manual check (§13).
- **Type consistency:** `ParsedTopic`/`ParsedComment`/`ParsedViewpoint`/`BcfCamera`/`BcfComponents` are Phases B/C/D's exact shapes; `readBcfZip`/`writeBcfZip` signatures; the `camera`/`components` JSON columns store the same shapes.
- **Test-config compliance:** codec unit (no DB/HTTP, in-memory round-trip); models compile + migrate on the test DB.
- **Integration points to verify during execution:** the current `ChangeLog` CHECK list; `fast-xml-parser` attribute handling vs real `.bcfzip` files (test against a Solibri/BIMcollab export); Prisma `Json`/`String[]` support (Postgres — yes).
