# NodeScope Map

The Map screen is the native desktop interface for viewing and placing network
equipment geographically. It uses Mapsui with raster tiles served by the local
NodeScope appliance.

## Map Controls

- **Zoom:** Device categories appear at different zoom levels.
  - ISP equipment such as RAD, ONT, and DSLAM appears at zoom 10 and closer.
  - Core infrastructure such as routers and firewalls appears at zoom 13 and
    closer.
  - Switches and access points appear at zoom 16 and closer.
  - End-user devices appear at zoom 18 and closer.
- **Layer toggles:** Each device category can be shown or hidden.
- **Buildings toggle:** Switches between appliance-rendered tile styles with and
  without buildings.
- **Floor selector:** Shows all floors, one selected floor, or the manual
  connection-oriented display mode.

Map preferences are saved to the user's appliance profile.

## Placing Devices

Select the + button, then click the map where the device belongs. The device form
uses that latitude and longitude. Existing devices can be relocated through the
same map placement interaction.

Only users with configuration access see placement and edit controls.

## Fiber Runs

Fiber runs are orange dashed lines between placed endpoint devices. They become
visible at zoom 13 and closer. A run is omitted when either endpoint has no map
coordinates.

## Home Marker and Workstation Metrics

Settings can geocode and save a home address. The map centers on that saved
location and shows it as a blue marker with a halo.

While the workspace is open, the desktop measures its connection to the
appliance every 30 seconds. Available latency, download, and upload values appear
beside the home marker and in Inventory > Clients.

## Local-First Tiles

The supported appliance builds and serves its configured map region under
`/tiles`. After that region is built, displaying the base map needs no public
tile provider. If tiles are missing, the desktop shows a warning and continues
to render device and fiber overlays.

Inventory data still comes from the appliance. The desktop does not currently
offer an offline mutation queue.
