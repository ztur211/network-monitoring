# NodeScope tiles image

The Decision 15 map stack, server side: `tileserver-gl` (MapLibre GL Native)
rasterizes the product's liberty basemap on the appliance, so the desktop map
fetches every tile from this box and nothing crosses the WAN at runtime. The
client consumes `/tiles/styles/{id}/{z}/{x}/{y}.png` through Caddy
(512px and `@2x` variants exist for HiDPI).

## What is baked into the image vs. what lives on the volume

**Image** (this directory, built by `deploy/docker-compose.build.yml`):

- `upstream/liberty.json` - the OpenFreeMap liberty style, vendored verbatim
  from `https://tiles.openfreemap.org/styles/liberty` so image builds are
  reproducible instead of tracking a mutable URL. Refresh it deliberately by
  re-downloading; `adapt-style.py` re-derives the served styles at build.
- `adapt-style.py` - derives the two served styles (`liberty`,
  `liberty-nobuildings`) with local glyph/sprite/source refs, the Natural Earth
  underlay dropped, and the building paint the web client used to apply at
  runtime baked in. Two styles exist because raster clients cannot toggle a
  style layer - the client's Buildings toggle swaps styles instead.
- Glyphs: the three Noto Sans fontstacks liberty references, from the
  `openmaptiles/fonts` v2.0 release (Noto fonts are SIL OFL 1.1).
- Sprites: OpenFreeMap's versioned `ofm_f384` sheet - the exact icons the web
  map showed.
- `config.json` - tileserver-gl config. Renderer pools are capped to fit the
  service's memory limit (`TILES_MEMORY_LIMIT`, default 768m).

**Volume** (`tiledata`): `region.mbtiles`, an OpenMapTiles-schema extract for
the deployment's region, generated once at install by `nodescope.sh tiles`
(planetiler, pinned in `docker-compose.prod.yml`). `TILES_AREA` is a Geofabrik
slug and `TILES_BBOX` optionally trims the output; see `deploy/.env.example`.
Until the extract exists the server stays healthy (`--ignore-missing-files`)
and 404s the styles.

Note the schema constraint: liberty reads the **OpenMapTiles** vector schema,
which is why the extract is generated with planetiler's openmaptiles profile.
Protomaps bbox extracts use Protomaps' own schema and will NOT work with this
style.

## Licensing / attribution

- Tile data: OpenStreetMap, ODbL. The map UI must show
  "(c) OpenStreetMap contributors" - the desktop client renders this
  attribution on the map view.
- Style: OpenFreeMap's liberty (derived from osm-liberty); sprites from
  OpenFreeMap. Fonts: Noto (SIL OFL 1.1).

## Verifying by hand

```
docker build -t nodescope-tiles deploy/tiles
docker run --rm -p 8081:8080 -v nodescope_tiledata:/data nodescope-tiles \
  --config /assets/config.json --ignore-missing-files
curl -s localhost:8081/health                       # 200 once up
curl -s localhost:8081/styles/liberty/style.json    # 404 until region.mbtiles exists
curl -s -o tile.png localhost:8081/styles/liberty/13/2411/3079.png   # Manhattan, z13
```
