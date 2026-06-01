# NodeScope Map

The Map screen is the primary interface for viewing and managing your network topology.

## Map Controls

- **Zoom**: Different device categories become visible at different zoom levels
  - ISP equipment (RAD, ONT, DSLAM): city-level zoom (z10+)
  - Core infrastructure (Routers, Firewalls): neighborhood zoom (z13+)
  - Network equipment (Switches, APs): street-level zoom (z16+)
  - End-user devices: highest zoom (z18+)
- **Layer toggles**: Show/hide device categories using the controls panel
- **Floor selector**: Filter by floor when devices have floor numbers set

## Placing Devices

Tap + to add a device. Enter GPS coordinates manually or use your browser's location to place at current position.

## Fiber Runs

Fiber cable runs are shown as orange dashed lines between devices, visible at zoom level 13+.

## Live Location

A pulsing blue dot shows your current browser location (requires location permission).

## Offline Mode

When your connection drops, the map shows the last known device positions with a stale data indicator. Changes queued while offline are sent when the connection restores.
