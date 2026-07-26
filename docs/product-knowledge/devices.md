# NodeScope Devices

Devices represent physical or logical equipment documented inside an
organization. Each device has a unique name within the organization, a category,
and optional network, property, map, addressing, floor, ownership, and notes
fields.

## Device Categories

- **ISP equipment:** RAD, ONT, and DSLAM
- **Core infrastructure:** Router, modem, fiber media converter, and firewall
- **Network equipment:** Switch, access point, WiFi extender, wireless bridge,
  server rack, patch panel, and UPS
- **End-user equipment:** Computer, phone, tablet, printer, and IoT device
- **Other:** Custom equipment that does not fit a predefined category

Categories determine marker color, abbreviation, map layer grouping, and the
minimum zoom at which a device appears.

## Adding and Placing Devices

Use Inventory > Equipment to create a device without map coordinates, or select
the + button on the Map and click its physical location. Name and category are
required. A device placed on a property must use a site chartered to its network.

OWNER and ADMIN members can configure equipment. Scoped permissions determine
which properties and devices are visible and editable.

## Editing and Deleting

Select a device from Equipment or the Map to edit or delete it. Updates carry a
base version. If another session changes the same device first, NodeScope rejects
the stale update instead of overwriting newer data.

Deleting a device removes links that depend on it where the database relationship
requires that behavior. A linked circuit remains but loses its device reference.

## Connections and Fiber Runs

The appliance API supports Ethernet, Fiber, WiFi, and Logical connections between
devices. It also supports physical fiber runs with optional cable type and length.
The native Map renders fiber runs as orange dashed lines when both endpoints have
coordinates.

The current desktop client does not yet expose creation forms for connections or
fiber runs.

## Live Updates

Device edits, deletions, placement changes, and monitoring status updates arrive
through SignalR. The map and 3D viewer update without requiring a manual refresh.
