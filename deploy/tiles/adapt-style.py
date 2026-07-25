#!/usr/bin/env python3
"""Adapt the vendored OpenFreeMap liberty style for the appliance tileserver.

Runs at image build (see Dockerfile). Takes the pristine upstream style and
produces the two styles the appliance serves:

  liberty.json              - the product basemap
  liberty-nobuildings.json  - same, with the building layers hidden

Two styles exist because the client consumes RASTER tiles (Decision 15): the
web app toggled the `building` style layer client-side, which is impossible
against baked pixels, so the toggle becomes a swap between two rendered styles.

Transforms, and why each one:
  - Local refs: glyphs/sprite/source URLs point at tileserver-gl's local
    conventions instead of tiles.openfreemap.org - the appliance must render
    with zero WAN (the local-first rule that motivated Decision 15).
  - Drop the `ne2_shaded` raster source + `natural_earth` layer: it is a
    world-scale shaded-relief underlay fetched from OpenFreeMap, pointless for
    a region extract and a WAN dependency.
  - Building paint: bake the override the web client applied at runtime
    (MapView.tsx: liberty's defaults are near-invisible). The web override
    only touched the `building` fill layer while `building-3d` kept drawing
    its own color at z14+; here both layers get the override color, and the
    no-buildings variant hides both, so the toggle is consistent at every
    zoom - a deliberate fix of the web behavior, not a regression.
"""

import copy
import json
import sys
from pathlib import Path

BUILDING_FILL = "hsl(35,12%,78%)"
BUILDING_OUTLINE = "hsl(35,15%,55%)"
BUILDING_LAYERS = ("building", "building-3d")


def adapt(upstream: dict) -> dict:
    style = copy.deepcopy(upstream)
    style["name"] = "NodeScope Liberty"
    style["glyphs"] = "{fontstack}/{range}.pbf"
    style["sprite"] = "ofm"

    del style["sources"]["ne2_shaded"]
    style["sources"]["openmaptiles"] = {"type": "vector", "url": "mbtiles://{region}"}
    style["layers"] = [l for l in style["layers"] if l["id"] != "natural_earth"]

    by_id = {l["id"]: l for l in style["layers"]}
    building = by_id["building"]
    building["paint"]["fill-color"] = BUILDING_FILL
    building["paint"]["fill-outline-color"] = BUILDING_OUTLINE
    by_id["building-3d"]["paint"]["fill-extrusion-color"] = BUILDING_FILL
    return style


def hide_buildings(style: dict) -> dict:
    variant = copy.deepcopy(style)
    variant["name"] = "NodeScope Liberty (no buildings)"
    for layer in variant["layers"]:
        if layer["id"] in BUILDING_LAYERS:
            layer.setdefault("layout", {})["visibility"] = "none"
    return variant


def main() -> None:
    upstream_path, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    upstream = json.loads(upstream_path.read_text())

    liberty = adapt(upstream)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "liberty.json").write_text(json.dumps(liberty, indent=1, sort_keys=True))
    (out_dir / "liberty-nobuildings.json").write_text(
        json.dumps(hide_buildings(liberty), indent=1, sort_keys=True)
    )
    print(f"wrote {out_dir}/liberty.json and liberty-nobuildings.json")


if __name__ == "__main__":
    main()
