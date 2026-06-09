# Spec 1 — Spatial Foundation (Device 3D Coordinates + Versioned Building Models)

- **Status:** Draft for review
- **Date:** 2026-06-09
- **Spec:** Spec 1 (3D/spatial track — first; head of Spec 1 → 2 → 3 → 4, runs parallel to the permissions track and converges at Spec 4)
- **Depends on:**
  - **F1a** *Public Interface* (§10) — org tenancy, `OrganizationMember` + `role`, `@OrgId()`/`@OrgRoles()`, the repository-layer org-scoping seam, `NodeScopeException`, `ChangeLog` audit, the `org:{organizationId}` realtime room, optimistic-concurrency `version` + `ChangesetChangeDto`, the `ORG_*` registry, the `{ success, data, timestamp }` envelope.
  - **F2** *Public Interface* (§10) — the `Property` tree (the `BUILDING` type) and `PropertiesService` (resolving a device's `BUILDING` ancestor via `propertyId`; `isAtOrUnder`); the F2 delete-block this spec extends.
- **Downstream consumers:** **Spec 2** (desktop shell), **Spec 3** (3D viewport — downloads the active IFC to render via web-ifc), **Spec 4** (nodes in 3D — authoring `x/y/z`, needs F3), **Spec 5** (IFC export — reads stored models). Read only the *Public Interface* (§10).

---

## 1. Context

NodeScope is pivoting to a 3D BIM + GIS platform: network nodes shown in 3D against a shared building model. Today the model is flat and 2D — a `Device` carries only `latitude`/`longitude`/`floor`/`floorLabel`, there is no building-model storage, no object storage, and no desktop/3D code (only `apps/api` + `apps/web`).

Spec 1 lays the **server-side spatial data foundation**: every building can own an **org-owned, versioned IFC building model**, and every device gains **3D coordinates** local to its building's model. It does **not** render anything — it is the substrate the desktop shell (Spec 2), the 3D viewport (Spec 3), 3D node placement (Spec 4), and IFC export (Spec 5) build on. The server **stores and serves** IFC bytes; it does **not** parse them (web-ifc parses client-side, Spec 3).

> **Forward-design note.** F1a/F2 are specced/planned but not yet built; this spec is written against their documented interfaces in the existing codebase's conventions, like F2/F3. Build order on the permissions track is independent; Spec 4 is where the two tracks meet (it needs F3).

## 2. Goals

1. A per-building, org-owned, **versioned** `BuildingModel` (immutable versions + an active-version pointer), **1:1 with a F2 `BUILDING` Property**.
2. IFC bytes in **S3-compatible object storage**; metadata in Postgres; **proxied** upload/download through the API (streaming, a configurable max size, content-hash).
3. `Device` gains nullable, **model-local** `x`/`y`/`z` (meters); the 2D fields are retained untouched; a **basic** set/clear endpoint (rich authoring is Spec 4).
4. A clean **Public Interface** (§10) for Specs 2–5.

## 3. Non-Goals (explicitly out of scope for Spec 1)

- **3D rendering, the viewport, the desktop app** → Spec 2 / Spec 3.
- **Rich 3D placement/authoring UX** (snapping, drag-in-viewport, multi-select) → Spec 4 (needs F3).
- **Server-side IFC parsing/geometry** — the server stores/serves bytes; web-ifc parses client-side (Spec 3). Server validation is shallow (extension/magic/size/hash).
- **IFC export** → Spec 5.
- **Presigned / direct-to-bucket transfer** and **resumable (tus) uploads** — future opt-ins (§14); v1 is proxied.
- **F3 site-scoped permissions on models** — coarse `OWNER`/`ADMIN` now; F3 site-scoping integrates around the Spec 4 timeframe.
- **Per-version coordinate rebinding** — a model's origin is assumed **stable across versions** (versions refine geometry, they don't relocate the building).

## 4. Data Model

Additive to `apps/api/prisma/schema.prisma`. New models are org-scoped and follow F1a conventions (repository-only access, `version` where mutable, `ChangeLog` audit, org-room events).

### 4.1 `BuildingModel` — one per `BUILDING`, points at the active version

```prisma
model BuildingModel {
  id              String   @id @default(uuid())
  organizationId  String
  propertyId      String   // the BUILDING Property this model represents (validated type=BUILDING)
  name            String
  activeVersionId String?  // current version; null only between create and first finalized upload
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  organization  Organization           @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  property      Property               @relation(fields: [propertyId], references: [id], onDelete: Restrict)
  activeVersion BuildingModelVersion?  @relation("ActiveVersion", fields: [activeVersionId], references: [id], onDelete: SetNull)
  versions      BuildingModelVersion[] @relation("ModelVersions")

  @@unique([organizationId, propertyId]) // one model per building
  @@index([organizationId])
}
```

### 4.2 `BuildingModelVersion` — immutable

```prisma
model BuildingModelVersion {
  id                 String   @id @default(uuid())
  organizationId     String
  buildingModelId    String
  versionNumber      Int      // 1,2,3… monotonic per model
  storageKey         String   // object-store key (see §4.5)
  fileName           String
  contentHash        String   // sha256 of the bytes (integrity + dedupe)
  sizeBytes          Int
  units              String?  // declared IFC length unit if known (e.g. "METRE")
  uploadedByMemberId String?  // OrganizationMember.id
  createdAt          DateTime @default(now())

  organization  Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  buildingModel BuildingModel @relation("ModelVersions", fields: [buildingModelId], references: [id], onDelete: Cascade)

  @@unique([buildingModelId, versionNumber])
  @@index([organizationId])
  @@index([buildingModelId])
}
```

(The `BuildingModel.activeVersion` ↔ `BuildingModelVersion.buildingModel` cycle is two named Prisma relations — `"ActiveVersion"` and `"ModelVersions"`; the migration creates the tables then the FKs.)

### 4.3 `Device` — model-local 3D coordinates

```prisma
model Device {
  // ... existing fields incl. latitude/longitude/floor (2D, untouched) ...
  x Float?  // NEW — model-local meters in the device's BUILDING's active model space
  y Float?  // NEW
  z Float?  // NEW
}
```

Additive and nullable. The 2D map fields stay exactly as they are (the web app is unaffected).

### 4.4 `onDelete` posture

| Relation | Behavior |
|---|---|
| `BuildingModel.property` → `Property` | `Restrict` — a building with a model can't be deleted out from under it (extends F2's delete-block → `MODEL_008`). |
| `BuildingModelVersion.buildingModel` → `BuildingModel` | `Cascade` (deleting a model removes its version rows). **The app must delete the bucket objects** — DB cascade does not touch object storage (§5). |
| `BuildingModel.activeVersion` → `BuildingModelVersion` | `SetNull` (defensive; deleting the active version is blocked anyway → `MODEL_005`). |
| `BuildingModel`/`BuildingModelVersion` → `Organization` | `Cascade`. |

### 4.5 Object storage + config

A new `StorageService` wraps an S3-compatible client (AWS SDK v3 / MinIO). Config via env (`STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_REGION`). Dev/test run **MinIO** in `docker-compose` (+ `docker-compose.test.yml`). Object key: `org/{organizationId}/building/{propertyId}/{versionId}.ifc`. The bucket is **private** — never client-reachable (matches the proxied design, §7).

## 5. Versioning & Activation

- **Upload** creates a new immutable `BuildingModelVersion` (next `versionNumber`), stores the object, then sets `BuildingModel.activeVersionId` to it. On first upload the `BuildingModel` row is created (if absent).
- **Rollback / activate** = repoint `activeVersionId` to any existing version of that model (`PUT …/active`). History is never mutated.
- **Delete a version**: blocked if it is the active one (`MODEL_005` — repoint first); otherwise the row **and its bucket object** are removed. Deleting the whole `BuildingModel` cascades version rows and the app deletes all its objects.
- Coordinates are **not** rebound on version change (origin stable, §3).

## 6. Coordinate Model

- `x/y/z` are **meters in the active model's coordinate space**, in the model's native frame (IFC is typically Z-up; the Y-up render conversion is Spec 3's viewport concern, not stored).
- A device's building is resolved via F2: `device.propertyId` → nearest `BUILDING` ancestor → that building's `BuildingModel`. `x/y/z` are interpreted against **that** model's active version.
- `x/y/z` are meaningful only when the device's property resolves to a `BUILDING` that **has a model**. Setting coordinates otherwise → `SPATIAL_001`. Clearing (set to null) is always allowed.
- Setting all three is atomic (a position is a triple); partial nulls are rejected (`SPATIAL_002`).
- If a device's governing `BUILDING` changes (its `propertyId` is moved to a different building, per F2), its `x/y/z` are **cleared** — coordinates are local to the prior model and don't carry across buildings.

## 7. Upload / Download (proxied through the API)

The API is in the data path; the bucket stays private.

- **Upload:** `POST …/versions` (multipart/stream). The API **streams** to the bucket (S3 multipart), enforcing `@OrgRoles('OWNER','ADMIN')`, a configurable **max size** (`MODEL_MAX_BYTES`, default 200 MB → `MODEL_006`), a shallow IFC check (extension `.ifc` + `ISO-10303-21;` magic prefix → else `MODEL_007`), and computes the **sha256** content hash while streaming. On success it writes the version row and activates it.
- **Download:** `GET …/versions/:versionId/file` (and `…/active/file`) **streams** the object back through the API with the right content-type/length.
- **No buffering** of whole files in memory; uploads/downloads stream. (Presigned URLs + resumable uploads are §14 future opt-ins.)

## 8. Authority & Enforcement

- **Org-scoped** (F1a): every `BuildingModel`/version query filters by `organizationId`; the `propertyId` is validated to belong to the org and be `type = BUILDING` (`MODEL_002`).
- **Mutations** (create model, upload version, activate, delete) require `@OrgRoles('OWNER','ADMIN')`; a MEMBER attempt → `ORG_003`. **Reads/downloads** require org membership. *(When F3 lands, these become site-scoped — managing a building's model = configuring that building's site; reads filter to assigned scope. Spec 4 is where that integration happens.)*
- **Audit & realtime** (F1a): model/version create/activate/delete writes `ChangeLog` (`entityType` `'BuildingModel'`/`'BuildingModelVersion'`); a `v1:buildingModel:*` event broadcasts to `org:{organizationId}`. Device `x/y/z` changes ride the existing `v1:device:updated` event.

## 9. Migration (greenfield)

Pre-launch, no data. The Prisma migration adds `BuildingModel`, `BuildingModelVersion`, the `Device.x/y/z` columns, and (raw SQL appended) extends F1a's `ChangeLog` entity-type CHECK to include `'BuildingModel'`/`'BuildingModelVersion'`. Seed scripts gain a sample building model + a placed (x/y/z) device. `docker-compose` gains a MinIO service; CI provisions a test bucket before integration/e2e.

## 10. Public Interface (the contract downstream specs cite)

Downstream specs (2–5) read **only this section**.

### 10.1 Shared DTOs (`packages/shared`)
- `BuildingModelDto { id, organizationId, propertyId, name, activeVersionId, version, createdAt, updatedAt }`
- `BuildingModelVersionDto { id, buildingModelId, versionNumber, fileName, contentHash, sizeBytes, units, uploadedByMemberId, createdAt }` (no `storageKey` — internal)
- `DeviceDto` gains `x: number | null`, `y: number | null`, `z: number | null`.
- `DevicePositionDto { x: number | null, y: number | null, z: number | null }`

### 10.2 Storage seam
- `StorageService` (`putObject(key, stream, contentType)`, `getObjectStream(key)`, `deleteObject(key)`, `objectExists(key)`) — the single abstraction over object storage; the only code that talks to the bucket. Specs 5 (export) and any future asset use it.

### 10.3 Error codes (register in the API Design Document)
- `MODEL_001 BUILDING_MODEL_NOT_FOUND` (404) · `MODEL_002 PROPERTY_NOT_BUILDING` (422) · `MODEL_004 MODEL_VERSION_NOT_FOUND` (404) · `MODEL_005 CANNOT_DELETE_ACTIVE_VERSION` (409) · `MODEL_006 MODEL_FILE_TOO_LARGE` (413) · `MODEL_007 INVALID_IFC_FILE` (422) · `MODEL_008 BUILDING_HAS_MODEL` (409, Property-delete block). *(Model creation is implicit on first upload; the one-per-building `@@unique` is the invariant, mapped to reuse — there is no user-facing duplicate-create error, so no `MODEL_003`.)*
- `SPATIAL_001 DEVICE_NOT_IN_MODELED_BUILDING` (422) · `SPATIAL_002 INCOMPLETE_POSITION` (422)
- Reuse F1a: `ORG_003`, `ORG_008`.

### 10.4 WebSocket events (room `org:{organizationId}`)
- `v1:buildingModel:versionUploaded` · `v1:buildingModel:activated` · `v1:buildingModel:deleted`
- Device coordinate changes use the existing `v1:device:updated` (payload now carries `x/y/z`).

### 10.5 Endpoints (mutations `OWNER`/`ADMIN`; reads any member)
- `GET /v1/buildings/:propertyId/model` → model + active-version metadata (`MODEL_001` if none)
- `GET /v1/buildings/:propertyId/model/versions` → version list
- `POST /v1/buildings/:propertyId/model/versions` → upload IFC (proxied stream), create-if-absent + activate
- `PUT /v1/buildings/:propertyId/model/active` → `{ versionId }` activate/rollback
- `GET /v1/buildings/:propertyId/model/versions/:versionId/file` · `GET /v1/buildings/:propertyId/model/active/file` → stream IFC
- `DELETE /v1/buildings/:propertyId/model/versions/:versionId` → delete a non-active version (+ object)
- `PATCH /v1/devices/:id/position` → `DevicePositionDto` set/clear `x/y/z`

## 11. Security Considerations

- The bucket is **private**; all access is proxied through the API, which is the single auth/validation chokepoint (org scoping + role + size/type/hash). No presigned exposure in v1.
- Object keys embed `organizationId`; the API never trusts a client-supplied key — it always derives it from the org-scoped model/version row, so cross-org object access is impossible (`ORG_008`).
- Upload is streamed with a hard size cap (`MODEL_006`) and a shallow IFC check (`MODEL_007`); deep validity is the client's concern (web-ifc), so a malformed-but-well-formed-enough file can be stored — it simply fails to render client-side, never executes server-side.
- Object deletion is tied to version-row lifecycle; orphan-object risk is confined to upload failures (mitigated: write the row only after the object lands, and a periodic reconcile can sweep keys with no row — §14).

## 12. Testing (TDD — test first)

- **Model/version (integration):** one-model-per-building uniqueness (`MODEL_003`); attach to non-`BUILDING` property rejected (`MODEL_002`); upload creates version N+1 + activates; rollback repoints active; delete active blocked (`MODEL_005`), delete non-active removes row + calls `StorageService.deleteObject`.
- **Storage seam:** `StorageService` mocked in unit tests; round-trip (put/get/delete/exists) against MinIO in integration.
- **Upload/download (e2e):** OWNER uploads a small `.ifc` → 201 + active set + a stored object; MEMBER upload → `ORG_003`; oversize → `MODEL_006`; non-IFC → `MODEL_007`; download streams identical bytes (hash matches).
- **Coordinates:** `PATCH …/position` on a device in a modeled building succeeds; in a building with no model / not under a BUILDING → `SPATIAL_001`; partial triple → `SPATIAL_002`; clear-to-null allowed; `DeviceDto` round-trips `x/y/z`.
- **Isolation/audit:** a model in org A invisible to org B (`ORG_008`); model/version CRUD writes `ChangeLog`.

## 13. Documentation (Rule 10 — same-commit doc updates)

- Register `MODEL_001`–`MODEL_008`, `SPATIAL_001`–`SPATIAL_002`, and the `v1:buildingModel:*` events in the API Design Document.
- Update the SAD: per-building versioned `BuildingModel`, object-storage seam (`StorageService`, MinIO), proxied upload/download, and `Device` 3D coordinates (model-local, 2D retained).
- Note in CLAUDE.md that object storage is now a dependency (MinIO in compose) and that IFC parsing is client-side only.

## 14. Open Questions (non-blocking; resolve during writing-plans / implementation)

- **Presigned transfer as a future opt-in:** add a config-toggled presigned mode (the "hybrid" path) if a cloud/large-file deployment ever needs to offload bytes from the API.
- **Orphan-object reconcile:** whether to ship the periodic sweep (keys with no version row) in v1 or defer; v1 mitigates by writing the row only after the object lands.
- **`units` capture:** whether to read the IFC length unit server-side (a shallow header scan) or accept it as an upload param; default = best-effort header scan, nullable.
- **Resumable uploads (tus):** deferred robustness for very large/flaky uploads.
- **`BuildingModel.name` source:** defaults to the `BUILDING` Property's name unless overridden — confirm.
