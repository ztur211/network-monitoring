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
  coordinates, with a small box marker. Each proxy carries **only its native IFC `GlobalId`** — a generic
  `Network Device` label and **no property set, and no device data of any kind**.
- Unplaced devices are excluded.

## Security — no network data leaves in the export

The exported IFC deliberately contains **zero network-sensitive data**: no IP addresses, MAC addresses, data
ports, device names, network names, categories, status, or monitoring metrics — nothing a monitoring tool
(SolarWinds / Cisco / Juniper Mist) would show. An exported model can be shared freely without leaking the
network's addressing or topology.

All of that data lives **only in NodeScope's access-controlled database**. NodeScope holds the
`device ↔ GlobalId` association and relays the live data **in-app** when you select an element — the file
points nowhere; **NodeScope points at the file**. (This is the same direction-of-reference that BCF uses:
reference elements by their native GlobalId, keep the meaning in the application.)

## Federating with the architectural model

The device coordinates are in the **building model's native frame** (the same space as the IFC you uploaded
for that building). Open the `*-network.ifc` alongside the architectural IFC as a **federated set sharing a
common origin** — the network nodes land in the correct positions. If the architectural model carries a site
offset / true-north, federate by shared coordinates (explicit offset matching is a future enhancement).

## Identity & re-association

Each device's `GlobalId` is **deterministic** (derived from the device id), so re-exporting after edits
produces stable ids — coordination/diff tools track the same elements across exports, and NodeScope can
re-associate an element back to its device by `GlobalId`. The **`GlobalId` is the durable key**; an element's
STEP express id (`#N`) is just a per-file line number and is *not* stable across a round-trip, so NodeScope
rebuilds the `GlobalId ↔ expressId` index each time it loads a model (the same mechanism BCF uses).
