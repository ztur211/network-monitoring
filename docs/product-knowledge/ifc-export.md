# IFC Export

NodeScope can export a building's placed network devices as a federated IFC2x3
network-discipline model. AEC teams can overlay that file on the architectural
model in tools such as Navisworks, Solibri, Revit, or Archicad.

## Export Endpoint

`GET /api/v1/buildings/{propertyId}/export/ifc` downloads
`{building}-network.ifc` with content type `application/x-step`.

`propertyId` is the ID of a BUILDING property. Any organization member who can
see the building can export it. Scoped members receive only their in-scope
placed devices.

The current desktop client does not yet expose an export button, so this
operation is available through the appliance API.

## Export Contents

- An `IfcProject -> IfcSite -> IfcBuilding -> IfcBuildingStorey` spatial tree
- One `Network` storey
- One `IfcBuildingElementProxy` for each device with model-local `x`, `y`, and
  `z` coordinates
- A stable IFC `GlobalId` for each exported device

Unplaced devices are excluded.

## Data Isolation

The export deliberately omits device names, categories, IP addresses, MAC
addresses, data ports, network names, status, metrics, and other
network-sensitive properties. Each proxy uses a generic `Network Device` label
and carries no NodeScope property set.

NodeScope keeps the device-to-GlobalId association in its access-controlled
database. The exported file does not point back to the appliance.

## Federation

Device coordinates use the uploaded building model's native coordinate frame.
Open the exported network IFC beside the architectural IFC as a federated set
with a common origin.

If the architectural model applies a site offset or true-north transform,
federate using the matching shared-coordinate configuration. Explicit export
offset matching is planned.

## Stable Identity

Each device GlobalId is derived deterministically from the NodeScope device ID.
Re-exporting therefore preserves element identity for coordination and diff
tools.

STEP express IDs such as `#42` are per-file line numbers and are not stable.
NodeScope rebuilds its GlobalId-to-express-ID index whenever it loads a model.
