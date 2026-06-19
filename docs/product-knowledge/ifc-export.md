# IFC Export (Federated Network-Discipline Model)

NodeScope can export a building's **placed network devices** as a federated **IFC2x3** discipline model that
AEC professionals overlay on the architectural building model in a coordination tool (Navisworks, Solibri,
Revit, ArchiCAD).

## How to export

`GET /v1/buildings/:propertyId/export/ifc` → downloads `{building}-network.ifc`
(`Content-Type: application/x-step`). The `propertyId` is the `BUILDING` Property's id. Any member who can
see the building may export; the file contains only the caller's **in-scope** placed devices.

## What's in the file

- An `IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey` spatial tree (one `Network` storey).
- Each **placed** device (one with model-local `x/y/z`) as an `IfcBuildingElementProxy` at those native
  coordinates, with a small box marker and a **`Pset_NodeScope`** property set
  (`Category`, `IPAddress`, `MACAddress`, `Network`, `NodeScopeId`).
- Unplaced devices are excluded.

## Federating with the architectural model

The device coordinates are in the **building model's native frame** (the same space as the IFC you uploaded
for that building). Open the `*-network.ifc` alongside the architectural IFC as a **federated set sharing a
common origin** — the network nodes land in the correct positions. If the architectural model carries a site
offset / true-north, federate by shared coordinates (explicit offset matching is a future enhancement).

Each device's `GlobalId` is **deterministic** (derived from the device id), so re-exporting after edits
produces stable ids — coordination/diff tools track the same elements across exports.
