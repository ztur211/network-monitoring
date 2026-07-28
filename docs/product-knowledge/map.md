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

## Derived Pins from the 3D Model

When a building model carries a map anchor (a georeference), every device placed
in the 3D viewer gets its map pin derived from that placement: the appliance
projects the model-frame position onto WGS84 and keeps the pin in lockstep with
the 3D position. Setting or changing the anchor re-derives every placed device in
the building, and the map updates live over SignalR.

A derived pin cannot be moved from the map - the edit form hides Relocate and the
location line says the position comes from the 3D placement. Moving the device in
the 3D viewer (or clearing its 3D position) is the way to move or release the
pin. Devices in buildings without an anchor keep ordinary manual pins.

The anchor comes from the IFC itself when the file is georeferenced (IfcSite
latitude/longitude plus the model's TrueNorth), extracted automatically at
import. It can also be set or corrected in the 3D viewer's Model tab under Map
anchor: enter the building's coordinates and true-north rotation, and the model's
footprint centre is pinned there.

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
