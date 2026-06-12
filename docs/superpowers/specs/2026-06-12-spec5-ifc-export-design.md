# Spec 5 — IFC Export (Federated Network-Discipline Model)

- **Status:** Draft for review
- **Date:** 2026-06-12
- **Spec:** Spec 5 (interop track — independent/unblocked; depends on Spec 1 only). Exports NodeScope's placed devices as a federated IFC discipline model for AEC tools. (BCF round-trip is the separate, deferred Spec 6.)
- **Depends on:**
  - **Spec 1** *Public Interface* (§10) — `Device.x/y/z` (model-local meters in the building model's **native frame**), the per-building `BuildingModel` whose coordinate space those coordinates live in, and the `BUILDING` `Property`.
  - **F2/F3** *Public Interface* — `Device.propertyId`, `PropertiesService.subtreePropertyIds` (the building's devices), F3 `scopeFilter` (in-scope only), `Network` (names).
  - **F1a** — org tenancy, the `{ success, data }` envelope, `NodeScopeException`.
- **Downstream consumers:** none — external AEC tools (Navisworks / Solibri / Revit / ArchiCAD) consume the exported `.ifc`. Not consumed by other specs.

---

## 1. Context

The pivot's interop story: external AEC professionals don't use NodeScope — they **consume its network as a federated IFC discipline model** overlaid on the architectural building model in a coordination tool. Spec 1 gave every `Device` model-local `x/y/z` in its building's native coordinate space. Spec 5 emits, per building, a **hand-templated IFC2x3** file containing the building's **placed devices** as `IfcBuildingElementProxy` elements at those coordinates, with NodeScope attributes as IFC property sets — aligned to the source model's coordinates so it federates correctly. No new dependency (the API has no web-ifc; the file is generated as ISO-10303-21 text).

## 2. Goals

1. A pure, deterministic **IFC2x3 writer** that turns a building + its placed devices into a valid STEP file.
2. A **deterministic uuid→IFC-GUID** encoder so re-exports are stable (coordination diffs work).
3. Each device → an `IfcBuildingElementProxy` (placed, marker geometry, `Pset_NodeScope`).
4. An **F3-scoped streaming endpoint** `GET /v1/buildings/:propertyId/export/ifc`.
5. Coordinate alignment with the source building model (federation by shared coordinates).

## 3. Non-Goals (explicitly out of scope for Spec 5)

- **BCF** (issue/markup round-trip) → the deferred Spec 6.
- **Importing IFC**, editing the architectural model, or **including building geometry** — the export is a *federated discipline overlay* (devices only).
- **IFC4 / typed network entities** (`IfcCommunicationsAppliance`, etc.) — IFC2x3 + generic proxies in v1 (an IFC4 variant is §12).
- **web-ifc / IfcOpenShell** — a hand-templated STEP generator (no new dependency).
- **Storing / versioning exports** — on-demand generation in v1 (StorageService persistence is §12).
- **Unplaced devices** (no `x/y/z`) — excluded from the export.

## 4. The generated IFC2x3 model

A valid IFC2x3 STEP file:
- **Header:** `FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1')`, `FILE_NAME` (the filename, ISO timestamp, author `NodeScope`), `FILE_SCHEMA(('IFC2X3'))`.
- **Project context:** `IfcProject` (`Name = 'NodeScope Network — {building}'`) + `IfcUnitAssignment` (SI `LENGTHUNIT` `.METRE.`) + a 3D `IfcGeometricRepresentationContext` (precision, world origin, +Z up, true-north +Y).
- **Spatial tree** (`IfcRelAggregates`): `IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey` — one storey named `'Network'` hosting all devices; each element has an `IfcLocalPlacement` at the **identity** (so coordinates remain the model's native space).
- **Per placed device** → an **`IfcBuildingElementProxy`**:
  - `GlobalId = toIfcGuid(device.id)` (deterministic), `Name = device.name`, `ObjectType = device.category`.
  - `ObjectPlacement` = `IfcLocalPlacement` relative to the storey at `IfcCartesianPoint((x, y, z))`.
  - `Representation` = `IfcProductDefinitionShape` → `IfcShapeRepresentation('Body','SweptSolid')` → a **0.2 m box** (`IfcExtrudedAreaSolid` of an `IfcRectangleProfileDef`) as a marker.
  - **Contained** in the storey via `IfcRelContainedInSpatialStructure`.
  - **`Pset_NodeScope`** (`IfcPropertySet` via `IfcRelDefinesByProperties`) with `IfcPropertySingleValue` rows: `Category`, `IPAddress`, `MACAddress`, `Network`, `NodeScopeId`.
- No placed devices ⇒ the header + spatial tree with **zero proxies** (a valid, empty discipline stub).

## 5. Coordinate alignment

`Device.x/y/z` are meters in the building model's **native frame** (Spec 1; no Y-up/recenter — those were Spec 3's *render* concerns). The export places proxies at exactly those coordinates under identity spatial placements, so the file shares the **same coordinate space as the source `BuildingModel`**. Opened alongside the architectural IFC in a coordination tool, the network nodes land in the correct positions (the standard "federated set from a shared origin"). If a source model carries a site offset / true-north, exact alignment relies on the consumer federating by shared coordinates (the §12 note covers explicit offset matching).

## 6. Generator architecture

`apps/api/src/export/`:
- **`ifc-guid.ts`** — pure `toIfcGuid(uuid: string): string`: the 128-bit UUID → IFC's 22-character base-64 compression (alphabet `0-9A-Za-z_$`). Deterministic + tested against known vectors.
- **`ifc2x3-writer.ts`** — a pure builder: an entity-id counter (`#1, #2, …`) and an append buffer; helpers emit the header, project/units/context, the spatial tree, and a proxy (+ placement + geometry + pset + containment) per device. **`buildNetworkIfc({ building, storey, devices }): string`** — no I/O, fully unit-testable.
- **`export.service.ts`** — gathers the building's **in-scope placed devices** (F2 subtree of the `BUILDING` `propertyId` ∩ F3 `scopeFilter`, `x/y/z` not null) + their `Network` names, then calls the writer.
- **`export.controller.ts`** — the streaming endpoint (§7).

## 7. Endpoint, scope & errors

- **`GET /v1/buildings/:propertyId/export/ifc`** → the IFC text streamed as `Content-Type: application/x-step`, `Content-Disposition: attachment; filename="{building}-network.ifc"`.
- **Scope:** the `propertyId` must be an in-scope `BUILDING` `Property` of the org — otherwise **404** (out-of-scope and unknown buildings are indistinguishable, per F3's invisible-not-forbidden rule). Devices are F3 **scope-filtered** — a caller sees only the in-scope placed devices; MEMBER may export (it is a read).
- **Generation:** on-demand (the text is small); not persisted. Audited as a read action only.

## 8. Public Interface

This spec is a leaf (no NodeScope consumer). Its outward contract is the **exported IFC2x3 file**: a federated discipline model whose `IfcBuildingElementProxy` GlobalIds are the deterministic `toIfcGuid(device.id)` (stable across exports) and whose `Pset_NodeScope` carries `Category`/`IPAddress`/`MACAddress`/`Network`/`NodeScopeId`. (Reusable internally: `toIfcGuid` and `buildNetworkIfc` if other IFC outputs are ever needed.)

## 9. Security Considerations

- **F3 scoping:** the export contains only the caller's in-scope devices — an export can never leak out-of-scope or cross-org devices (the device query goes through `scopeFilter`; `propertyId` is org-validated).
- **No secrets:** the export carries device metadata (name, category, IP/MAC, network) — the same data the caller can already read via the device API; no credentials/tokens are included.
- **Read-only, no new attack surface:** generation is pure string assembly from already-authorized data; no file is stored, no external process is spawned.
- **Injection-safety:** device strings (names, IPs) are **STEP-escaped** (`'` → `''`, control/non-ASCII → IFC `\X2\…\X0\` encoding) so a crafted device name can't break the IFC syntax.

## 10. Testing (TDD — test first)

- **`toIfcGuid`** (unit): a known UUID → its known 22-char IFC GUID; deterministic (same input → same output); output length 22 + valid alphabet.
- **`buildNetworkIfc`** (unit): two placed devices → asserts `FILE_SCHEMA(('IFC2X3'))`, exactly one `IFCBUILDINGELEMENTPROXY` per device, each device's `(x,y,z)` present in an `IFCCARTESIANPOINT`, a `Pset_NodeScope` with the category + IP, and one `IFCRELCONTAINEDINSPATIALSTRUCTURE`; **zero devices** → header + `IFCBUILDINGSTOREY` + no proxies; a device name with a `'` is STEP-escaped.
- **`export.service`** (integration): only in-scope, placed devices are included; unplaced (`x/y/z` null) and out-of-scope devices are excluded.
- **Endpoint** (e2e): `GET …/export/ifc` → 200, `Content-Type: application/x-step`, `Content-Disposition` filename, body starts `ISO-10303-21;`; out-of-scope building → 404; MEMBER may export.
- *Deep IFC validity / tool import (Navisworks/Solibri) is verified manually with a sample export — out of automated scope.*

## 11. Documentation (Rule 10 — same-commit doc updates)

- API Design Document: `GET /v1/buildings/:propertyId/export/ifc` (response type, scope, filename).
- SAD/CLAUDE.md: the IFC2x3 export (hand-templated STEP, `Pset_NodeScope`, federated by shared coordinates); note `toIfcGuid`/`buildNetworkIfc` are the reusable IFC primitives.
- A short `docs/product-knowledge` note: how an AEC consumer federates the `*-network.ifc` against the architectural model.

## 12. Open Questions (non-blocking; resolve during writing-plans / implementation)

- **Per-floor storeys:** group devices into `IfcBuildingStorey`s by `device.floor` (vs the single `'Network'` storey) — better navigation in the consumer, more spatial-tree code.
- **Stored / versioned exports:** persist via Spec 1's `StorageService` with an export history (vs on-demand only).
- **IFC4 variant:** add an IFC4 output (richer typed entities) behind a query param if a consumer needs it.
- **Per-category geometry:** distinct marker shapes/sizes per `DeviceCategory` (vs a uniform 0.2 m box).
- **Site offset / true-north:** read the source model's placement to bake an explicit offset (vs relying on shared-origin federation).
- **Unplaced-device summary:** include a count / list of unplaced devices as a project-level pset (vs silently excluding).
