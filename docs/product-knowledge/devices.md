# NodeScope Devices

NodeScope lets you document every physical device on your network. Each device has a name, category, optional location (latitude/longitude), floor, IP address, MAC address, and notes.

## Device Categories

- **ISP Equipment**: RAD, ONT, DSLAM — usually at the network edge
- **Core Infrastructure**: Router, Modem, Fiber Media Converter, Firewall
- **Network Equipment**: Switch, Access Point, WiFi Extender, Wireless Bridge, Server Rack, Patch Panel, UPS
- **End-User Devices**: Computer, Phone, Tablet, Printer, IoT Device
- **Other**: Custom

## Device Limit

Free tier accounts can document up to 50 devices. A warning appears at 45 devices.

## Adding Devices

Tap the + button on the map or use the Equipment screen. Required fields: name (must be unique), category. All other fields are optional.

## Connections and Fiber Runs

Devices can be linked with:
- **Connections** (DeviceConnection): Ethernet, Fiber, WiFi, or Logical connection type between two devices
- **Fiber Runs**: Physical cable runs between two devices, with optional cable type and length in meters

## Editing and Deleting

Tap a device on the map or in the Equipment list to view its details. From the detail panel, use Edit or Delete. Edits use optimistic concurrency — if two sessions edit the same device simultaneously, one will get a conflict error.
