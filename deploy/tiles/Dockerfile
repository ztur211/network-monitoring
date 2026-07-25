# NodeScope tiles image (Decision 15): tileserver-gl with the liberty style,
# Noto Sans glyphs, and the OpenFreeMap sprite sheet baked in, rasterizing an
# OpenMapTiles-schema region extract (region.mbtiles on the /data volume,
# produced at install by build-region.sh). The client fetches
# /styles/{liberty|liberty-nobuildings}/{z}/{x}/{y}.png through Caddy at
# /tiles/* - no WAN leaves the appliance for map tiles at runtime.
#
# Assets are fetched at IMAGE BUILD (WAN is fine here - the appliance pulls
# the finished image from GHCR); every fetch is pinned and fails the build
# loudly if upstream moves. Provenance + licenses: see README.md.

FROM python:3.13-alpine AS assets

RUN apk add --no-cache curl unzip

WORKDIR /build

# Glyph PBFs: the three Noto Sans fontstacks the liberty style references,
# from the openmaptiles/fonts v2.0 release (SIL OFL).
RUN curl -fsSL -o noto-sans.zip \
      https://github.com/openmaptiles/fonts/releases/download/v2.0/noto-sans.zip \
 && unzip -q noto-sans.zip -d fonts-all \
 && mkdir fonts \
 && mv "fonts-all/Noto Sans Regular" "fonts-all/Noto Sans Bold" "fonts-all/Noto Sans Italic" fonts/ \
 && rm -rf fonts-all noto-sans.zip

# Sprite sheet: the exact liberty icons the web map showed (OpenFreeMap's
# versioned ofm_f384 build - a moved path fails the build, not the runtime).
RUN mkdir sprites && cd sprites \
 && for f in ofm.json ofm.png ofm@2x.json ofm@2x.png; do \
      curl -fsS -o "$f" "https://tiles.openfreemap.org/sprites/ofm_f384/$f"; \
    done

# The two served styles, derived from the vendored upstream style.
COPY upstream/liberty.json upstream.json
COPY adapt-style.py .
RUN python3 adapt-style.py upstream.json styles

FROM maptiler/tileserver-gl:v5.6.0

COPY --from=assets /build/fonts /assets/fonts
COPY --from=assets /build/sprites /assets/sprites
COPY --from=assets /build/styles /assets/styles
COPY config.json /assets/config.json

# region.mbtiles lives here (named volume; see `nodescope.sh tiles`).
VOLUME /data

# --ignore-missing-files: before the region extract is built the server must
# still come up healthy (compose --wait gates install on it); it then serves
# /health 200 and 404s the styles until region.mbtiles appears (verified on
# v5.6.0 - without the flag the process crash-loops on the missing file).
CMD ["--config", "/assets/config.json", "--ignore-missing-files"]
