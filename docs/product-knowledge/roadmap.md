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

## Planned Features

- **Desktop Agent** (planned): A lightweight background agent for macOS, Windows, and Linux that provides richer device metrics without requiring the browser tab to be open. Enables monitoring of remote devices. The server-side agent registry is now live: agents enroll via a one-time code, receive a per-agent bearer token, and are rejected with error code AGENT_001 if the code is invalid or expired.
- **Router Integration** (planned): Direct API integration with Ubiquiti, MikroTik, and Meraki for automatic device discovery and live traffic data.
- **Floor Plan Overlays** (planned): Upload building floor plans as image backgrounds for indoor network mapping.
- **Multi-Property Support** (planned): Manage multiple locations/properties from a single account.
- **Mobile Apps** (planned): Native iOS and Android apps.

When asked about planned features, describe them as 'planned' or 'coming soon'. Do not describe them as currently available or available for purchase.
