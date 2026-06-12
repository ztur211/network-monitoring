# Spec 6 Phase E — Desktop Issues Panel, Navigation & Realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire BCF into the desktop viewport: the `@nodescope/client` BCF methods, a `useBcf` hook (load + realtime), viewport **navigation** (apply a resolved viewpoint to the Spec 3/4 camera + visibility + selection), the **Issues panel** with import/export + **create-from-view**, completing Spec 6.

**Architecture:** `useBcf` loads the building's topics + subscribes to `v1:bcf:*`. `navigateToViewpoint` dispatches a `ResolvedViewpoint` (Phase D) into the stores (camera via a new `viewportStore` viewpoint request → a `ViewCommands` effect; visibility → hidden sets; selection). `IssuesPanel` (Spec 4 right-dock pattern) lists/creates topics; create-from-view reads the live camera + selection + a `toDataURL` snapshot.

**Tech Stack:** React 19 DOM, `@react-three/fiber`, Zustand, Vitest + RTL; `@nodescope/client`.

**Depends on:** Phase C (endpoints), Phase D (`applyViewpoint`/`captureViewpoint`/`guidIndex`), Spec 3 (`ViewCommands`, `viewportStore`), Spec 4 (`node-coords`, selection, devices, the Node-panel pattern). Spec: `2026-06-12-spec6-bcf-design.md` (§9, §10).

---

## File Structure

**Create:** `apps/desktop/src/renderer/viewport/bcf/{use-bcf.ts, navigate-viewpoint.ts, ui/IssuesPanel.tsx}`; tests.
**Modify:** `packages/client/src/rest-client.ts` (BCF methods); `stores/viewport-store.ts` (`viewpointRequest`); `scene/ViewCommands.tsx` (apply a viewpoint camera); `shell/ViewportHost.tsx` (mount the panel).

---

## Task 1: `@nodescope/client` BCF methods (Vitest)

- [ ] **Step 1: Failing test** (mocked fetch): `listBcfTopics` GETs; `createBcfTopic` POSTs; `exportBcf` returns a blob/buffer.
```typescript
it('listBcfTopics + createBcfTopic hit the building routes', async () => {
  const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: [{ id: 't' }], timestamp: '' }) });
  const c = createRestClient({ baseUrl: 'http://h/api', getToken: async () => 't', fetchImpl: f });
  await c.listBcfTopics('b'); expect(f.mock.calls[0][0]).toContain('/v1/buildings/b/bcf/topics');
  await c.createBcfTopic('b', { title: 'x' }); expect(f.mock.calls[1][1].method).toBe('POST');
});
```

- [ ] **Step 2: Run → FAIL**, then add to the REST client:
```typescript
listBcfTopics(buildingId: string): Promise<BcfTopicDto[]> { return this.get(`/v1/buildings/${buildingId}/bcf/topics`); }
createBcfTopic(buildingId: string, dto: CreateBcfTopicDto): Promise<BcfTopicDto> { return this.post(`/v1/buildings/${buildingId}/bcf/topics`, dto); }
patchBcfTopic(id: string, dto: PatchBcfTopicDto): Promise<BcfTopicDto> { return this.patch(`/v1/bcf/topics/${id}`, dto); }
addBcfComment(id: string, dto: AddBcfCommentDto): Promise<void> { return this.post(`/v1/bcf/topics/${id}/comments`, dto); }
exportBcfUrl(buildingId: string): string { return `${this.baseUrl}/v1/buildings/${buildingId}/bcf/export`; } // download via the bridge/browser with the token
```

- [ ] **Step 3: Run → PASS.** Commit `feat(client): BCF topic/comment methods`.

---

## Task 2: `useBcf` (Vitest)

- [ ] **Step 1: Failing test** — loads topics for the building, applies a realtime create:
```typescript
import { loadBcfTopics, applyBcfEvent } from '../use-bcf';
import { useBcfStore } from '../use-bcf';
it('loads topics and applies a realtime topic event', async () => {
  await loadBcfTopics('b', { listBcfTopics: async () => [{ id: 't1', title: 'A' }] } as any, () => true);
  expect(useBcfStore.getState().topics.map((t: any) => t.id)).toEqual(['t1']);
  applyBcfEvent('created', { id: 't2', title: 'B' } as any);
  expect(useBcfStore.getState().topics.find((t: any) => t.id === 't2')).toBeTruthy();
});
```

- [ ] **Step 2: Run → FAIL**, then implement `use-bcf.ts` (a small store + load + realtime, mirroring Spec 4's device load):
```typescript
import { create } from 'zustand';
import { useEffect } from 'react';
import { WS_EVENTS } from '@nodescope/shared';
import type { BcfTopicDto } from '@nodescope/shared';
import { useViewportStore } from '../../stores/viewport-store';
import { getClients } from '../../data/clients';

export const useBcfStore = create<{ topics: BcfTopicDto[]; set: (t: BcfTopicDto[]) => void; upsert: (t: BcfTopicDto) => void }>((s) => ({
  topics: [], set: (topics) => s({ topics }), upsert: (t) => s((st) => ({ topics: st.topics.some((x) => x.id === t.id) ? st.topics.map((x) => (x.id === t.id ? t : x)) : [...st.topics, t] })),
}));

export async function loadBcfTopics(buildingId: string, rest: { listBcfTopics(id: string): Promise<BcfTopicDto[]> }, isCurrent: () => boolean) {
  try { const t = await rest.listBcfTopics(buildingId); if (isCurrent()) useBcfStore.getState().set(t); } catch { if (isCurrent()) useBcfStore.getState().set([]); }
}
export function applyBcfEvent(kind: 'created' | 'updated', topic: BcfTopicDto) { useBcfStore.getState().upsert(topic); }

export function useBcf() {
  const buildingId = useViewportStore((s) => s.activeBuildingPropertyId);
  useEffect(() => {
    const rest = getClients()?.rest as any; if (!buildingId || !rest) { useBcfStore.getState().set([]); return; }
    let active = true; loadBcfTopics(buildingId, rest, () => active && useViewportStore.getState().activeBuildingPropertyId === buildingId);
    return () => { active = false; };
  }, [buildingId]);
  useEffect(() => {
    const rt = getClients()?.realtime; if (!rt) return;
    const up = (t: BcfTopicDto) => applyBcfEvent('updated', t);
    rt.on(WS_EVENTS.BCF_TOPIC_CREATED, up); rt.on(WS_EVENTS.BCF_TOPIC_UPDATED, up);
    return () => { rt.off?.(WS_EVENTS.BCF_TOPIC_CREATED, up); rt.off?.(WS_EVENTS.BCF_TOPIC_UPDATED, up); };
  }, []);
}
```
Add `BCF_TOPIC_CREATED: 'v1:bcf:topic:created'`, `BCF_TOPIC_UPDATED: 'v1:bcf:topic:updated'`, `BCF_COMMENT_ADDED: 'v1:bcf:comment:added'` to `@nodescope/shared` `WS_EVENTS` (the server emits these in Phase C — add the emit there or here, F3-scoped per the topic's building).

- [ ] **Step 3: Run → PASS.** Commit `feat(desktop): useBcf (load + realtime)`.

---

## Task 3: `navigateToViewpoint` + camera application (Vitest)

- [ ] **Step 1: Failing test** — dispatching a resolved viewpoint sets the stores:
```typescript
import * as THREE from 'three';
import { navigateToViewpoint } from '../navigate-viewpoint';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';
it('applies camera + hidden + selection to the stores', () => {
  useViewportStore.setState(initialViewportState(), true);
  navigateToViewpoint({ camera: { position: new THREE.Vector3(1, 2, 3), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fov: 60 },
    selectionDeviceIds: ['dev1'], selectionExpressIds: [], hiddenExpressIds: [9] });
  const s = useViewportStore.getState();
  expect(s.selection).toEqual({ kind: 'device', deviceId: 'dev1' });
  expect([...s.hiddenElements]).toEqual([9]);
  expect(s.viewpointRequest?.camera.position.x).toBe(1);
});
```

- [ ] **Step 2: Run → FAIL**, then add `viewpointRequest` to `viewport-store.ts` (`{ camera, nonce } | null` + `setViewpointRequest`) and implement `navigate-viewpoint.ts`:
```typescript
import type { ResolvedViewpoint } from './apply-viewpoint';
import { useViewportStore } from '../../stores/viewport-store';
export function navigateToViewpoint(r: ResolvedViewpoint): void {
  const s = useViewportStore.getState();
  s.setHiddenElements(new Set(r.hiddenExpressIds));                 // a store helper that replaces hiddenElements
  if (r.selectionDeviceIds[0]) s.selectNode(r.selectionDeviceIds[0]);
  else if (r.selectionExpressIds[0] != null) s.selectElement(r.selectionExpressIds[0]);
  else s.clearSelection();
  s.setViewpointRequest({ camera: r.camera, nonce: (s.viewpointRequest?.nonce ?? 0) + 1 });
}
```
Extend `ViewCommands.tsx` (Spec 3/4) with an effect on `viewpointRequest.nonce` that sets `camera.position/up`, `lookAt(target)`, and `controls.target`, then `invalidate()`. Add `setHiddenElements(set)` to the store (replace, vs `hideElement` add).

- [ ] **Step 3: Run → PASS.** Commit `feat(desktop): navigate to a BCF viewpoint`.

---

## Task 4: `IssuesPanel` + create-from-view (Vitest + RTL)

- [ ] **Step 1: Failing test** — lists topics, selecting navigates; create-from-view posts a captured viewpoint:
```tsx
it('lists topics and navigates on select', async () => {
  useBcfStore.setState({ topics: [{ id: 't1', title: 'Clash', topicStatus: 'Open', viewpoints: [{ id:'v', guid:'g', camera:{kind:'perspective',position:[0,0,5],direction:[0,0,-1],up:[0,1,0]}, components:{selection:[],visibility:{defaultVisibility:true,exceptions:[]}}, hasSnapshot:false, isPrimary:true }], comments: [], deviceIds: [] } as any] });
  useViewportStore.setState({ model: fakeModelWithFrame() });
  render(<IssuesPanel />);
  fireEvent.click(screen.getByText('Clash'));
  expect(useViewportStore.getState().viewpointRequest).toBeTruthy(); // navigated
});
```

- [ ] **Step 2: Run → FAIL**, then implement `IssuesPanel.tsx` (Spec 4 right-dock pattern; client-injected/store-driven):
```tsx
import { useBcf, useBcfStore } from '../use-bcf';
import { useViewportStore } from '../../../stores/viewport-store';
import { applyViewpoint } from '../apply-viewpoint';
import { navigateToViewpoint } from '../navigate-viewpoint';
import { canConfigure } from '../../nodes/can-configure';
import { toIfcGuid } from '@nodescope/shared';

export function IssuesPanel() {
  useBcf();
  const topics = useBcfStore((s) => s.topics);
  const { model, devices, access } = useViewportStore();
  const navigate = (t: any) => {
    const vp = t.viewpoints?.[0]; if (!vp || !model) return;
    const deviceGuidMap = new Map(devices.map((d: any) => [toIfcGuid(d.id), d.id]));
    navigateToViewpoint(applyViewpoint(vp, model.frame, model.guidIndex, deviceGuidMap));
  };
  return (
    <aside aria-label="issues">
      {canConfigure(access) && <button onClick={() => {/* create-from-view (Task 4 Step 3) */}}>New issue from view</button>}
      <ul>{topics.map((t: any) => (
        <li key={t.id}><button onClick={() => navigate(t)}>{t.title}</button> · {t.topicStatus}</li>
      ))}</ul>
    </aside>
  );
}
```

- [ ] **Step 3: Create-from-view.** Add a handler that reads the live camera (a `viewportStore` `cameraSnapshot` updated by a small in-Canvas reporter, or `ViewCommands` exposes the camera), the current `selection` (device id), and `gl.domElement.toDataURL('image/png')` → `captureViewpoint(...)` → `client.createBcfTopic(buildingId, { title, viewpoint: { ...captured, snapshotBase64 } })`; on success the realtime/`upsert` adds it. Mount `<IssuesPanel/>` in `ViewportHost`'s `ready` slot (right dock, beside the Node panel).

- [ ] **Step 4: Run → PASS.** Commit `feat(desktop): BCF Issues panel + viewpoint navigation + create-from-view`.

---

## Task 5: Phase gate + cross-plan review

- [ ] **Step 1: Suites.** `cd apps/desktop && npm test -- bcf use-bcf navigate-viewpoint IssuesPanel`; `cd apps/api && npm run test:e2e -- bcf` → green.
- [ ] **Step 2: Typecheck** (api + desktop + client + shared) → PASS.
- [ ] **Step 3: Manual end-to-end:** import a `.bcfzip` (from Solibri) → topics list; click one → the camera flies to the viewpoint + the referenced device highlights; create an issue from the current view → it appears + exports in a `.bcfzip` that re-opens in the AEC tool at the right view.
- [ ] **Step 4: Docs (Rule 10).** `apps/desktop/README.md` (Issues panel + BCF); the `docs/product-knowledge` coordination workflow; SAD/CLAUDE.md (BCF complete).
- [ ] **Step 5: Commit** `docs: record Spec 6 BCF desktop + realtime (Phase E) + BCF complete`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** client BCF methods (§8) ✓ Task 1; `useBcf` load + realtime `v1:bcf:*` (§10) ✓ Task 2; viewpoint navigation (camera + visibility + selection) (§9) ✓ Task 3; Issues panel + create-from-view + snapshot (§9) ✓ Task 4; F3-gated create affordance (`canConfigure`) (§8) ✓ Task 4.
- **Deferred (correctly per spec):** multi-viewpoint switcher, coloring, BCF-API/3.0 (spec §3, §15).
- **Placeholder scan:** none — concrete code; the create-from-view camera source + snapshot are wired in Task 4 Step 3 (a stated, concrete integration, not a TODO).
- **Type consistency:** `BcfTopicDto`/`CreateBcfTopicDto` (Phase C) ↔ client ↔ panel; `applyViewpoint`/`ResolvedViewpoint`/`captureViewpoint` (Phase D); `viewpointRequest`/`setHiddenElements`/`selectNode`/`selectElement` (Spec 3/4 store + here); `WS_EVENTS.BCF_*` (added); `toIfcGuid` (shared); `canConfigure` (Spec 4).
- **Test-config compliance:** client (mocked fetch), hook + navigation (store-driven), panel (RTL + mocked stores). The camera application + `toDataURL` are exercised manually.
- **Integration points to verify during execution:** `WS_EVENTS.BCF_*` emit on the server (Phase C add) + F3 scoping; the live-camera source for create-from-view (`ViewCommands`/an in-Canvas reporter); `gl.domElement.toDataURL` from the r3f canvas; mounting the panel without crowding the Spec 4 Node panel in the right dock.

---

# Spec 6 — cross-plan self-review (all five phases)

- **Spec coverage (full):** §4 architecture (server `bcf` module + desktop `viewport/bcf`) → A–E ✓ · §5 models → A ✓ · §6 `.bcfzip` codec → A ✓ · §7 device/element GUID linking → B (devices) + D (`guidIndex` elements) ✓ · §8 endpoints + F3 (reads/export open, mutations OWNER/ADMIN) → B (import) + C (export/CRUD) ✓ · §9 viewport integration (navigation, create-from-view, coordinate convert) → D (pure) + E (wiring) ✓ · §10 realtime → E ✓ · §11 public interface (`.bcfzip`, issue REST, `bcf-zip`, `apply/capture`, `ParsedModel.guidIndex`) → A/C/D ✓ · §12 security (F3, defensive parsing, private snapshots, audit) → B/C ✓ · §13 testing → every phase ✓.
- **Build-green order:** A (models + codec) → B (import) → C (export + CRUD + endpoints) → D (pure viewpoint logic) → E (desktop wiring + realtime). Each ends green; the server (A–C) is independently testable before the desktop (D–E).
- **Cross-phase type consistency:** `ParsedTopic`/`ParsedViewpoint`/`BcfCamera`/`BcfComponents` (A) flow through import (B), export (C), and the codec; `toIfcGuid` (Spec 5, shared in D) underpins device links (B/C) + GUID resolution (D); `ResolvedViewpoint` (D) ↔ `navigateToViewpoint` (E); `CreateBcfTopicDto.viewpoint` (C) ↔ `captureViewpoint` output (D); `StorageService` (Spec 1) for snapshots (B/C); F3 `inScope`/`assertCanConfigure` consistent across B/C; `ParsedModel.guidIndex` (D) consumed by `applyViewpoint`.
- **Flagged for execution:** the `ChangeLog` CHECK + `BCF_*`/conflict codes (A–C); `StorageService` + `FileInterceptor` (B/C); the `web-ifc` GlobalId read + the `toIfcGuid` extraction (D); the live-camera source + `toDataURL` + `WS_EVENTS.BCF_*` emit (E); real-tool `.bcfzip` interop (manual). All localized.
- **Track complete:** Spec 5 (federated IFC export) + Spec 6 (BCF round-trip) close the **interop track** — AEC pros consume NodeScope's nodes as IFC and collaborate via BCF, with issues tied to devices by the shared deterministic IFC GUID. This is the final roadmap spec.
