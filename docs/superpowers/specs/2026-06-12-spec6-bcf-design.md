# Spec 6 — BCF (BIM Collaboration Format Round-Trip)

- **Status:** Draft for review
- **Date:** 2026-06-12
- **Spec:** Spec 6 (interop track — second/last; the BCF 2.1 file round-trip that lets AEC pros exchange coordination issues against NodeScope's nodes). The final roadmap spec.
- **Depends on:**
  - **Spec 5** *Public Interface* — `toIfcGuid(device.id)` (the device ↔ IFC GUID link; topics reference NodeScope devices by this GUID, and exports resolve against Spec 5's federated NodeScope IFC).
  - **Spec 3** *Public Interface* (§11) — `ParsedModel` (extended here with a `guid→expressID` map), `ViewCommands`/camera, the r3f viewport.
  - **Spec 4** *Public Interface* (§11) — `node-coords` (`toViewport`/`toModel`), the unified selection, the Node-panel pattern + the canvas.
  - **Spec 1** — `StorageService` (snapshot PNGs).
  - **F2/F3** — the building `propertyId` (a topic's `governingSiteId`), `scopeFilter`, scoped realtime; **F1a** — org tenancy, `ChangeLog`, the `{ success, data }` envelope.
- **Downstream consumers:** none — external AEC tools consume the exported `.bcfzip`. Completes the interop track.

---

## 1. Context

The federated-IFC export (Spec 5) lets AEC tools *see* NodeScope's network; BCF lets them **collaborate** on it — raising coordination issues (clashes, RFIs) with camera viewpoints + component references, exchanged as `.bcfzip` archives. Spec 6 builds the **file-based BCF 2.1 round-trip**: import AEC-raised topics (mapping their component IFC GUIDs onto NodeScope devices), show + navigate them in the Spec 3/4 viewport, author new topics from the live view, and export back to `.bcfzip`. (The BCF-API REST protocol is a deferred follow-up.)

## 2. Goals

1. A `BcfTopic` / `BcfComment` / `BcfViewpoint` model (+ a derived `BcfTopicDevice` link), org- and F3-scoped.
2. A **BCF 2.1 `.bcfzip` reader/writer** (markup + viewpoint + snapshot), lossless round-trip.
3. **Device linking** via Spec 5's `toIfcGuid`; architectural-element GUIDs preserved verbatim.
4. **Import / export / CRUD** endpoints, F3-scoped to the building.
5. **Viewport integration:** navigate a viewpoint (camera + visibility + selection) and **create a topic from the current view** (with a canvas snapshot).
6. F3-scoped **realtime** topic/comment updates.

## 3. Non-Goals (explicitly out of scope for Spec 6)

- **BCF-API** (the REST collaboration server + its OAuth) → a separate later spec. File `.bcfzip` only.
- **BCF 3.0** — BCF 2.1 (the universally supported baseline) in v1.
- **Authoring the architectural model / clash detection** — NodeScope consumes/produces issues, it doesn't run clash analysis.
- **Multi-viewpoint navigation UI** — a topic may carry several viewpoints; v1 navigates the **primary**, round-trips the rest.
- **BCF component coloring** and **bitmaps** — round-tripped verbatim if present, not authored/rendered in v1.

## 4. Architecture

Server `bcf` module (`apps/api/src/bcf/`): the models, a pure `bcf-zip` reader/writer, an import/export service, and the topic/comment CRUD + endpoints. Desktop `viewport/bcf/`: the Issues panel + viewpoint navigation + create-from-view, reusing Spec 3 (camera/`ViewCommands`, `ParsedModel`) and Spec 4 (`node-coords`, selection, canvas). Snapshots live in Spec 1's object storage.

```
apps/api/src/bcf/  bcf.repository.ts  bcf-zip.ts (pure parse/serialize)  bcf-import.service.ts  bcf-export.service.ts  bcf.controller.ts
apps/desktop/src/renderer/viewport/bcf/  IssuesPanel.tsx  apply-viewpoint.ts  capture-viewpoint.ts  use-bcf.ts
```

## 5. Data model

Org-scoped (F1a); a topic is anchored to a `BUILDING` `Property` (`propertyId`) — its `governingSiteId` for F3.
- **`BcfTopic`**: `id, organizationId, propertyId, guid (BCF), title, topicType?, topicStatus?, priority?, labels (String[]), creationAuthor, creationDate, modifiedAuthor?, modifiedDate?, assignedTo?, dueDate?, description?, version, createdAt, updatedAt`. `@@unique([organizationId, guid])` (re-import dedupe).
- **`BcfComment`**: `id, organizationId, topicId, guid, comment, author, date, viewpointGuid?`.
- **`BcfViewpoint`**: `id, organizationId, topicId, guid, camera (Json), components (Json), clippingPlanes (Json), snapshotKey? (object-store key), isPrimary Boolean`.
  - `camera`: `{ kind: 'perspective'|'orthographic', position:[x,y,z], direction:[x,y,z], up:[x,y,z], fieldOfView?|viewToWorldScale? }` (native/world coords).
  - `components`: `{ selection: string[], visibility: { defaultVisibility: boolean, exceptions: string[] }, coloring?: Json }` (IFC GUIDs).
- **`BcfTopicDevice`** (derived): `topicId ↔ deviceId` — populated on import/author by matching a viewpoint's component GUID against `toIfcGuid(device.id)`. Enables "issues on this device". `onDelete: Cascade` from topic/device.

## 6. `.bcfzip` mapping (BCF 2.1)

A pure **`bcf-zip.ts`** over the BCF 2.1 archive (`jszip` for the container; an XML parser/serializer — `fast-xml-parser`):
- `bcf.version` (`VersionId="2.1"`).
- per topic `{guid}/markup.bcf` — `Markup` → `Topic` (+ attributes/`Comment`s) ↔ `BcfTopic` + `BcfComment`.
- `{guid}/viewpoint.bcfv` — `VisualizationInfo` → `PerspectiveCamera`/`OrthogonalCamera` + `Components` (`Selection`, `Visibility`, `ViewSetupHints`) + `ClippingPlanes` ↔ `BcfViewpoint`.
- `{guid}/snapshot.png` ↔ `snapshotKey`.
`readBcfZip(buffer) → ParsedBcf` and `writeBcfZip(topics) → Buffer` are pure and round-trip-tested; **unknown/extra XML is preserved** on viewpoints (raw passthrough) so export is lossless.

## 7. Device & element GUID linking

- A BCF component GUID equal to `toIfcGuid(device.id)` for some in-org device → a `BcfTopicDevice` link (so the device's marker highlights and "issues on this device" works).
- Non-matching GUIDs (architectural elements from the source model) are **kept verbatim** in the viewpoint JSON and re-exported unchanged; in the viewport they resolve **best-effort** via Spec 3's `ParsedModel` `guid→expressID` map (web-ifc exposes each element's `GlobalId`), else they're listed but not highlighted.
- NodeScope-authored topics emit **device IFC GUIDs**, which the architect's tool resolves against Spec 5's federated NodeScope IFC.

## 8. Endpoints & scope

F3-scoped to the building's topics (a topic is in scope iff its `propertyId` is in the caller's scope). **Reads (view, export) are open to any in-scope member; every mutation (import, author, comment, change status) requires OWNER/ADMIN** — a MEMBER mutation → `ORG_003`, matching F3's binary verb ceiling (export is a read, like Spec 5's IFC export).
- `POST /v1/buildings/:propertyId/bcf/import` (multipart `.bcfzip`) → parse, upsert topics by `guid`, store snapshots, derive device links.
- `GET /v1/buildings/:propertyId/bcf/export` → stream a `.bcfzip` of the building's in-scope topics.
- `GET /v1/buildings/:propertyId/bcf/topics` (list) · `GET /v1/bcf/topics/:id` · `POST /v1/buildings/:propertyId/bcf/topics` (author, with an optional viewpoint + snapshot) · `PATCH /v1/bcf/topics/:id` (status/assignee/priority, `baseVersion`) · `POST /v1/bcf/topics/:id/comments`.

## 9. Viewport integration

- **Issues panel** (`IssuesPanel.tsx`, the Spec 4 right-dock pattern): the building's topics with status/priority/assignee, filterable; selecting one navigates its primary viewpoint.
- **`apply-viewpoint.ts`** (pure): a `BcfViewpoint` → `{ camera: { position, target, up, fov }, hidden: ExpressId[], hiddenDevices: string[], selection }` by (a) converting the BCF camera from native/world coords to the viewport's recentered-Y-up space via Spec 4 `node-coords` (`toViewport` the position; a derived target = position + direction; rotate `up`), and (b) mapping `components` GUIDs → devices (`toIfcGuid` match) + elements (`ParsedModel` guid map). The viewport applies it through Spec 3 `ViewCommands` (camera) + the Spec 3/4 visibility + selection stores.
- **`capture-viewpoint.ts`** (create-from-view): read the live camera (`toModel` inverse → native coords), the current selection's IFC GUID, the canvas snapshot (`gl.domElement.toDataURL('image/png')`), and the visibility state → a `BcfViewpoint` + PNG; POST a new topic.
- **`use-bcf.ts`**: loads topics for the active building (via `@nodescope/client`), drives realtime, and exposes the panel/navigation actions.

## 10. Realtime

`v1:bcf:topic:created` / `:updated` / `v1:bcf:comment:added` to `org:{organizationId}`, **F3-scoped by the topic's building** (reusing the F3 §8 fan-out) → the Issues panel updates live across clients.

## 11. Public Interface

Completes the interop track (no NodeScope downstream consumer). Outward contracts: the exported **`.bcfzip`** (BCF 2.1, with NodeScope device GUIDs from Spec 5) and the **issue REST surface** (`/v1/.../bcf/*`). Internally reusable: `bcf-zip` (`readBcfZip`/`writeBcfZip`) and `apply-viewpoint`/`capture-viewpoint`. Spec 3's `ParsedModel` gains a documented `guidIndex: Map<string, ExpressId>` (the element-GUID extension).

## 12. Security Considerations

- **F3 scoping** on every topic read/write/realtime — a caller never sees or exports topics for out-of-scope buildings; imported topics are anchored to the (in-scope) building in the URL.
- **Untrusted `.bcfzip`:** parsed defensively — a bounded archive size + entry count, zip-slip-safe path handling (no writes outside the parse), XML parsed without external entities (XXE-safe), snapshots validated as PNG before storage. A malformed archive → a 422, never a crash.
- **Snapshots** go through `StorageService` (private bucket, org-keyed) like Spec 1's models; no client-reachable keys.
- **Audit:** topic/comment create/status changes write `ChangeLog` (`entityType` `'BcfTopic'`/`'BcfComment'`) with the actor.

## 13. Testing (TDD — test first)

- **`bcf-zip`** (unit): parse a fixture `.bcfzip` → topic title/status, a comment, the viewpoint camera + selection GUIDs; **round-trip** `read→write→read` preserves fields, GUIDs, and unknown passthrough XML.
- **Device-link derivation** (unit): a component GUID == `toIfcGuid(device.id)` → a `BcfTopicDevice`; a non-matching GUID → kept as a raw ref, no link.
- **Import service** (integration): a `.bcfzip` → topics/comments/viewpoints upserted by `guid` (re-import updates, no dupes), snapshot stored, links derived.
- **Export service** (integration): the building's topics → a `.bcfzip` that `readBcfZip` re-parses to the same topics.
- **Endpoints** (e2e): multipart import; `.bcfzip` export download; topic CRUD + comment; **F3 scope** (out-of-scope building topics invisible → 404); a MEMBER may view + export but any mutation (import/author/comment/status) → `ORG_003`; an out-of-scope ADMIN mutation → `PERM_001`.
- **Desktop:** `apply-viewpoint` (pure: a viewpoint → camera in viewport space + resolved hidden/selection, mocked frame + maps); `capture-viewpoint` (camera `toModel` + selection GUID + a stubbed `toDataURL` → payload); `IssuesPanel` (RTL: list/filter/select drives navigation).
- *BCF interoperability against a real tool (Solibri/BIMcollab) is verified manually with a sample exchange.*

## 14. Documentation (Rule 10 — same-commit doc updates)

- API Design Document: the `/v1/.../bcf/*` endpoints, `v1:bcf:*` events, and the `BcfTopic`/`BcfComment` entity types.
- SAD/CLAUDE.md: the BCF round-trip (file `.bcfzip`, `StorageService` snapshots, viewport viewpoint navigation, the `ParsedModel.guidIndex` extension); note BCF-API/3.0 are deferred.
- `docs/product-knowledge`: the AEC coordination workflow (export federated IFC (Spec 5) → raise issues in a tool → import `.bcfzip` into NodeScope → resolve against the nodes).

## 15. Open Questions (non-blocking; resolve during writing-plans / implementation)

- **Element-GUID map depth:** ship the `ParsedModel.guidIndex` (all elements) now, or devices-only resolution with elements best-effort later.
- **Snapshot capture:** `toDataURL` resolution/size + whether to also auto-generate a snapshot for imported topics that lack one.
- **Multi-viewpoint topics:** a viewpoint switcher in the panel (vs primary-only navigation in v1).
- **Re-import conflict policy:** last-write-wins by `guid` (v1) vs a merge/version prompt when both sides edited a topic.
- **BCF 3.0 / BCF-API:** later specs; confirm the `bcf-zip` abstraction leaves room for a 3.0 writer.
- **XML library:** `fast-xml-parser` vs an alternative — confirm it preserves attribute order / unknown nodes well enough for lossless round-trip.
- **MEMBER comments:** v1 is strict F3 (every mutation, incl. comments, is OWNER/ADMIN); whether to allow MEMBER **comments** as a deliberate collaboration exception (without widening any other mutation) is open.
