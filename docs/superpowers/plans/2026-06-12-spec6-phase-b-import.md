# Spec 6 Phase B — BCF Import Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a `.bcfzip` into a building's topics — F3-gated (OWNER/ADMIN), upsert-by-GUID (re-import updates, no dupes), store snapshots in object storage, and derive `BcfTopicDevice` links by matching component IFC GUIDs against `toIfcGuid(device.id)`. Defensive against malformed/oversized archives.

**Architecture:** `deriveDeviceLinks` is pure (GUIDs + a `guid→deviceId` map → device ids). `BcfImportService` builds that map from the building's devices (Spec 5 `toIfcGuid`), reads the `.bcfzip` (Phase A), and writes topics/comments/viewpoints in a transaction, persisting snapshot PNGs via Spec 1's `StorageService`. Size/entry/PNG guards reject bad input as 4xx.

**Tech Stack:** NestJS, Prisma, Jest (unit + integration).

**Depends on:**
- **Phase A** — `readBcfZip`, `ParsedTopic`, the models.
- **Spec 5** — `toIfcGuid`.
- **Spec 1** — `StorageService` (snapshot bytes).
- **F2/F3** — `PropertiesService.subtreePropertyIds`, `PermissionsService.assertCanConfigure`.
- Spec: `2026-06-12-spec6-bcf-design.md` (§7, §8, §12).

> Export + CRUD + endpoints (Phase C); desktop (D–E).

---

## File Structure

**Create:** `apps/api/src/bcf/device-links.ts`, `apps/api/src/bcf/bcf-import.service.ts`; tests `bcf/__tests__/{device-links.spec.ts, bcf-import.service.spec.ts}`.

---

## Task 1: `deriveDeviceLinks` (Jest unit)

- [ ] **Step 1: Failing test** `bcf/__tests__/device-links.spec.ts`:
```typescript
import { deriveDeviceLinks } from '../device-links';

describe('deriveDeviceLinks', () => {
  it('links component GUIDs that match a device IFC GUID, dedupes, ignores the rest', () => {
    const map = new Map([['G-dev1', 'dev1'], ['G-dev2', 'dev2']]);
    expect(deriveDeviceLinks(['G-dev1', 'G-arch-wall', 'G-dev1', 'G-dev2'], map).sort()).toEqual(['dev1', 'dev2']);
    expect(deriveDeviceLinks(['G-arch-only'], map)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `bcf/device-links.ts`:
```typescript
export function deriveDeviceLinks(componentGuids: string[], deviceGuidToId: Map<string, string>): string[] {
  const ids = new Set<string>();
  for (const g of componentGuids) { const id = deviceGuidToId.get(g); if (id) ids.add(id); }
  return [...ids];
}
```

- [ ] **Step 3: Run → PASS.** Commit `feat(api): BCF device-link derivation`.

---

## Task 2: `BcfImportService` (Jest integration)

**Files:** Create `bcf-import.service.ts`; test `bcf/__tests__/bcf-import.service.spec.ts`.

- [ ] **Step 1: Failing integration test** — import builds topics + links + snapshot; re-import updates:
```typescript
// seed: org + BUILDING + a device with id deviceId; build a .bcfzip whose viewpoint selects toIfcGuid(deviceId).
it('imports topics, derives device links, stores the snapshot, and re-import dedupes by guid', async () => {
  const buf = await writeBcfZip([{ guid: 'T1', title: 'Issue', labels: [], creationAuthor: 'a', creationDate: '2026-06-12T00:00:00Z', comments: [],
    viewpoints: [{ guid: 'V1', isPrimary: true, camera: { kind: 'perspective', position: [0,0,0], direction: [0,0,-1], up: [0,1,0], fieldOfView: 60 },
      components: { selection: [toIfcGuid(deviceId)], visibility: { defaultVisibility: true, exceptions: [] } }, clippingPlanes: [], snapshotPng: PNG_BYTES }] }]);
  const r1 = await svc.importBcf(orgId, owner, buildingId, buf);
  expect(r1.imported).toBe(1);
  const topic = await prisma.bcfTopic.findFirst({ where: { organizationId: orgId, guid: 'T1' }, include: { devices: true, viewpoints: true } });
  expect(topic!.title).toBe('Issue');
  expect(topic!.devices.map((d) => d.deviceId)).toEqual([deviceId]);
  expect(topic!.viewpoints[0].snapshotKey).toContain('bcf/');
  expect(storage.putObjectStream).toHaveBeenCalled();
  await svc.importBcf(orgId, owner, buildingId, buf); // re-import
  expect(await prisma.bcfTopic.count({ where: { organizationId: orgId, guid: 'T1' } })).toBe(1); // no dupe
});
```
(`PNG_BYTES` = `Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a, ...])` — a valid PNG header.)

- [ ] **Step 2: Run → FAIL**, then implement `bcf-import.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import { PrismaService } from '../prisma/prisma.service';
import { PropertiesService } from '../properties/properties.service';
import { PermissionsService } from '../permissions/permissions.service';
import { StorageService } from '../storage/storage.service';
import { NodeScopeException } from '../common/errors/nodescope.exception';
import { toIfcGuid } from '../export/ifc-guid';
import { readBcfZip } from './bcf-zip';
import { deriveDeviceLinks } from './device-links';
import type { Member } from '../common/types';

const MAX_BCF_BYTES = Number(process.env.BCF_MAX_BYTES ?? 52428800); // 50 MB
const isPng = (b: Buffer) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

@Injectable()
export class BcfImportService {
  constructor(private readonly prisma: PrismaService, private readonly properties: PropertiesService, private readonly permissions: PermissionsService, private readonly storage: StorageService) {}

  private async deviceGuidMap(orgId: string, buildingPropertyId: string): Promise<Map<string, string>> {
    const subtree = await this.properties.subtreePropertyIds(orgId, buildingPropertyId);
    const devices = await this.prisma.device.findMany({ where: { organizationId: orgId, propertyId: { in: subtree } }, select: { id: true } });
    return new Map(devices.map((d) => [toIfcGuid(d.id), d.id]));
  }

  async importBcf(orgId: string, member: Member, buildingPropertyId: string, buffer: Buffer): Promise<{ imported: number }> {
    await this.permissions.assertCanConfigure(member, { type: 'Property', id: buildingPropertyId }); // OWNER/ADMIN in scope
    if (buffer.length > MAX_BCF_BYTES) throw new NodeScopeException('BCF_001', 'BCF archive too large', 413);
    let parsed; try { parsed = await readBcfZip(buffer); } catch { throw new NodeScopeException('BCF_003', 'Malformed BCF archive', 422); }
    const guidMap = await this.deviceGuidMap(orgId, buildingPropertyId);
    let imported = 0;
    for (const t of parsed.topics) {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.bcfTopic.findFirst({ where: { organizationId: orgId, guid: t.guid } });
        const data = { propertyId: buildingPropertyId, title: t.title, topicType: t.topicType ?? null, topicStatus: t.topicStatus ?? null, priority: t.priority ?? null,
          labels: t.labels, creationAuthor: t.creationAuthor, creationDate: new Date(t.creationDate), assignedTo: t.assignedTo ?? null, description: t.description ?? null };
        const topic = existing
          ? await tx.bcfTopic.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
          : await tx.bcfTopic.create({ data: { organizationId: orgId, guid: t.guid, ...data } });
        await tx.bcfComment.deleteMany({ where: { topicId: topic.id } });
        await tx.bcfViewpoint.deleteMany({ where: { topicId: topic.id } });
        await tx.bcfTopicDevice.deleteMany({ where: { topicId: topic.id } });
        for (const c of t.comments) await tx.bcfComment.create({ data: { organizationId: orgId, topicId: topic.id, guid: c.guid, comment: c.comment, author: c.author, date: new Date(c.date), viewpointGuid: c.viewpointGuid ?? null } });
        const guids: string[] = [];
        for (const v of t.viewpoints) {
          let snapshotKey: string | null = null;
          if (v.snapshotPng) {
            if (!isPng(v.snapshotPng)) throw new NodeScopeException('BCF_002', 'Invalid snapshot', 422);
            snapshotKey = `bcf/${orgId}/${t.guid}/${v.guid}.png`;
            await this.storage.putObjectStream(snapshotKey, Readable.from(v.snapshotPng), 'image/png');
          }
          await tx.bcfViewpoint.create({ data: { organizationId: orgId, topicId: topic.id, guid: v.guid, camera: v.camera as object, components: v.components as object, clippingPlanes: v.clippingPlanes as object, snapshotKey, isPrimary: v.isPrimary } });
          guids.push(...v.components.selection, ...v.components.visibility.exceptions);
        }
        for (const deviceId of deriveDeviceLinks(guids, guidMap)) await tx.bcfTopicDevice.create({ data: { topicId: topic.id, deviceId } });
        imported++;
      });
    }
    return { imported };
  }
}
```
Register `BCF_001`/`BCF_002`/`BCF_003`. (`StorageService.putObjectStream` is Spec 1's; `assertCanConfigure` is F3's.)

- [ ] **Step 3: Run → PASS.** Commit `feat(api): BCF import (upsert-by-guid + snapshots + device links)`.

---

## Task 3: Phase gate

- [ ] **Step 1: Suites.** `cd apps/api && npm run test:unit -- device-links && npm run test:integration -- bcf-import` → green; `npx tsc --noEmit` → PASS.
- [ ] **Step 2: Docs (Rule 10).** API Design Document: `BCF_001`–`BCF_003`; SAD: import (upsert, snapshots, device links, defensive guards).
- [ ] **Step 3: Commit** `docs: record Spec 6 BCF import (Phase B)`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** import → upsert-by-`guid` (§7, §8) ✓ Task 2; device links via `toIfcGuid` (§7) ✓ Tasks 1–2; snapshots in `StorageService` (§5, §12) ✓ Task 2; F3 `assertCanConfigure` (mutation = OWNER/ADMIN) (§8) ✓ Task 2; defensive size/PNG/malformed guards (§12) ✓ Task 2.
- **Deferred (correctly NOT here):** export + CRUD + the HTTP endpoints (Phase C); the desktop viewport (D–E). Architectural-element GUIDs are kept in `components` JSON (no link), per spec §7.
- **Placeholder scan:** none — complete code/commands.
- **Type consistency:** `deriveDeviceLinks(guids, Map)` ↔ the service; `readBcfZip`/`ParsedTopic` (Phase A); `toIfcGuid` (Spec 5); `StorageService.putObjectStream(key, Readable, contentType)` (Spec 1); `assertCanConfigure(member, {type,id})` (F3); the `camera`/`components` JSON match Phase A's shapes.
- **Test-config compliance:** pure unit + integration (test DB + a **mocked** `StorageService`). A valid PNG header buffer is used for the snapshot.
- **Integration points to verify during execution:** Spec 1 `StorageService.putObjectStream` signature; F3 `assertCanConfigure` entity arg; the building-device-set size for the GUID map (a scan — fine at current scale); zip entry-count guard inside `readBcfZip` for very large archives (add if needed).
