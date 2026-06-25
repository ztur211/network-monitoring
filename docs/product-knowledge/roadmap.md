# NodeScope Roadmap

## Available Now (Free Tier)

- Network mapping on GIS map (MapLibre GL + OpenFreeMap tiles)
- Document up to 50 devices with location, category, floor, IP, MAC
- Device connections (Ethernet, Fiber, WiFi, Logical)
- Fiber run documentation with cable type and length
- ISP circuit documentation
- Real-time browser metrics (latency, bandwidth, connection quality)
- AI assistant for troubleshooting and guidance
- Real-time sync across browser tabs via WebSocket
- Offline mode with optimistic updates and queue replay

## 3D Spatial Operations (Desktop App)

The desktop app loads the building's IFC model and fuses live network operations onto it:

- **3D BIM viewer** — navigate the building model (optimized for large models via per-category geometry merging).
- **In-app IFC import** — OWNER/ADMIN users import a building's IFC model directly from the desktop
  viewer (an "Import an IFC model" action on the empty state and in the toolbar); it uploads the file
  as a new model version, activates it as the live model, and reloads the viewport — no CLI required.
- **Devices as 3D equipment objects** — each placed device renders as a recognizable 3D object by category
  (a switch as a rack box, an access point as a dome, a rack as a tower), positioned where it physically lives.
- **Click an object → live info** — selecting a device's 3D object opens its drill-down: live metric chart
  (polled) and recent status-change events.
- **Link a BIM object to a device by GUID** — network infrastructure already modelled in the IFC can be
  linked to a NodeScope device by the element's native IFC GlobalId (GUID). Clicking that BIM object then
  surfaces the device's live network info. The GUID is the only join between the model and network data,
  so the IFC can be exported without any IP/MAC/metrics ever leaving NodeScope.
- **Live status in 3D** — a device's object is tinted by its real-time status (e.g. red when down).
- **Triage Ops HUD** — a building-wide health overview: down/warning counts, a severity-sorted device list
  (problems first), per-floor roll-up, and fly-to.
- **Data-isolated IFC export** — exporting the network model carries only geometry + native IFC GlobalIds;
  no IP/MAC/network data leaves NodeScope (see `ifc-export.md`).

## Planned Features

- **Desktop Agent** — Core is shipped (Spec 8). Agents enroll via a one-time code generated in the web app, receive a per-agent bearer token, report TCP/ICMP reachability + latency metrics, and appear in the Agents management list with last-seen timestamp. Invalid or expired codes are rejected with error code AGENT_001. Per-OS installer scripts (Linux/macOS/Windows) are included. SNMP polling is Spec 9 (next).
- **Router Integration** (planned): Direct API integration with Ubiquiti, MikroTik, and Meraki for automatic device discovery and live traffic data.
- **Floor Plan Overlays** (planned): Upload building floor plans as image backgrounds for indoor network mapping.
- **Multi-Property Support** (planned): Manage multiple locations/properties from a single account.
- **Mobile Apps** (planned): Native iOS and Android apps.

When asked about planned features, describe them as 'planned' or 'coming soon'. Do not describe them as currently available or available for purchase.
