// Only file in the codebase that imports maplibre-gl.
// All other components access map functionality through this component's props.
import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import maplibregl from 'maplibre-gl';
// Bundled, not CDN-loaded: the appliance runs on a LAN that may have no WAN at
// all, and a monitoring map that goes unstyled during an outage fails the same
// test as a dashboard that goes dark. Importing it also keeps the CSS locked to
// the same maplibre-gl version as the JS above.
import 'maplibre-gl/dist/maplibre-gl.css';

import { DeviceDto, FiberRunDto, DeviceCategory, DEVICE_CATEGORY_CONFIG } from '@nodescope/shared';
import { useDeviceStore } from '../../store/device.store';
import { useUiStore } from '../../store/ui.store';
import { useAuthStore } from '../../store/auth.store';
import { useRealtimeStore } from '../../store/realtime.store';
import { api } from '../../lib/api.service';
import { createDeviceMarkerElement, updateDeviceMarkerSelected } from './DeviceMarker';
import { createLiveMarkerElement, LiveMarkerInfo } from './LiveMarker';
import { FloorSelector } from './FloorSelector';
import { MapControls } from './MapControls';

const TILE_STYLE_URL =
  process.env.EXPO_PUBLIC_MAP_TILE_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty';

const MAP_CONTAINER_ID = 'ns-map-container';
const VIEWPORT_DEBOUNCE_MS = 300;
const FIBER_SOURCE_ID = 'ns-fiber-runs';
const FIBER_LAYER_ID = 'ns-fiber-layer';

interface FlyToTarget {
  // Bumping `key` is the signal — same coords with a new key re-fires the
  // animation. Lets callers re-trigger a fly without juggling "did this
  // ref change" prop diffing.
  key: number;
  latitude: number;
  longitude: number;
  zoom?: number;
}

interface MapViewProps {
  onDeviceClick: (device: DeviceDto) => void;
  selectedDeviceId?: string | null;
  // When true, taps on the map (not on a device marker) call onMapClick with
  // the picked lngLat. Cursor becomes a crosshair while active. Drives the
  // "tap to place a device" flow from app/(app)/map.tsx.
  placementMode?: boolean;
  onMapClick?: (lngLat: { longitude: number; latitude: number }) => void;
  // One-shot fly. Used after device create so the marker the user just
  // placed is actually in the viewport at a zoom where its category renders.
  flyTo?: FlyToTarget | null;
}

export function MapView({
  onDeviceClick,
  selectedDeviceId,
  placementMode,
  onMapClick,
  flyTo,
}: MapViewProps) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, { marker: maplibregl.Marker; el: HTMLDivElement }>>(
    new Map(),
  );
  const liveMarkerRef = useRef<maplibregl.Marker | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(13);
  const [mapBounds, setMapBounds] = useState<maplibregl.LngLatBounds | null>(null);
  const [fiberRuns, setFiberRuns] = useState<FiberRunDto[]>([]);
  const [tileError, setTileError] = useState(false);
  const [livePosition, setLivePosition] = useState<[number, number] | null>(null);

  // Narrow selectors: re-render only when `devices` changes, not on any device-store field.
  const devices = useDeviceStore((s) => s.devices);
  const upsertManyDevices = useDeviceStore((s) => s.upsertManyDevices);
  const { mapCenter, layerToggles, selectedFloor, floorDisplayMode, buildingsVisible, setMapCenter, setMapZoom } =
    useUiStore();
  const user = useAuthStore((s) => s.user);
  const metrics = useRealtimeStore((s) => s.metrics);

  // Initialize map
  useEffect(() => {
    const container = document.getElementById(MAP_CONTAINER_ID);
    if (!container || mapRef.current) return;

    const homeCenter = resolveInitialCenter(mapCenter, user);

    mapRef.current = new maplibregl.Map({
      container,
      style: TILE_STYLE_URL,
      center: homeCenter.center,
      zoom: homeCenter.zoom,
    });

    mapRef.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    mapRef.current.on('load', () => {
      setMapReady(true);
      const bounds = mapRef.current!.getBounds();
      setMapBounds(bounds);
      setCurrentZoom(mapRef.current!.getZoom());
      scheduleViewportLoad();
    });

    mapRef.current.on('moveend', () => {
      const m = mapRef.current!;
      const center = m.getCenter();
      setMapCenter([center.lng, center.lat]);
      setMapZoom(m.getZoom());
      setMapBounds(m.getBounds());
      scheduleViewportLoad();
    });

    // Update on zoomEND, not on every zoom frame: `currentZoom` drives marker
    // visibility (visibleDevices) and MapControls, so the per-frame `zoom` event
    // re-rendered the map and recomputed markers continuously during every gesture.
    mapRef.current.on('zoomend', () => {
      setCurrentZoom(mapRef.current!.getZoom());
    });

    mapRef.current.on('error', (e) => {
      if (e.error?.message?.includes('Failed to fetch') || (e as { tile?: unknown }).tile) {
        setTileError(true);
      }
    });

    // Capture geolocation once; rendering the marker happens in a dedicated
    // effect below so it can rebuild when the bound Device or its metrics
    // change.
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        setLivePosition([pos.coords.longitude, pos.coords.latitude]);
      });
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
      markersRef.current.forEach(({ marker }) => marker.remove());
      markersRef.current.clear();
      liveMarkerRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // One-shot fly target. Re-runs whenever `flyTo.key` changes — caller bumps
  // the key to re-fire even if center/zoom would be identical. Skips the
  // animation entirely until the map is ready.
  useEffect(() => {
    if (!mapRef.current || !mapReady || !flyTo) return;
    mapRef.current.flyTo({
      center: [flyTo.longitude, flyTo.latitude],
      zoom: flyTo.zoom ?? mapRef.current.getZoom(),
      essential: true,
    });
  }, [mapReady, flyTo?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Placement-mode click handler. Subscribes to `map.on('click', …)` only
  // while placementMode is true; unsubscribes (and restores the cursor) on
  // toggle-off or unmount. Device-marker clicks bubble up via their own
  // listeners and call stopPropagation, so this only fires on empty map.
  useEffect(() => {
    if (!mapRef.current || !mapReady || !placementMode || !onMapClick) return;
    const map = mapRef.current;
    const canvas = map.getCanvasContainer();
    const previousCursor = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';

    const handler = (e: maplibregl.MapMouseEvent): void => {
      onMapClick({ longitude: e.lngLat.lng, latitude: e.lngLat.lat });
    };
    map.on('click', handler);

    return () => {
      map.off('click', handler);
      canvas.style.cursor = previousCursor;
    };
  }, [mapReady, placementMode, onMapClick]);

  // Rebuild the live marker whenever the bound browser-device, its latest
  // ambient metrics, the click handler, or the geolocation fix changes. The
  // marker element is recreated rather than mutated in place — its DOM is
  // small enough that re-mounting on a ~30s metrics push is cheaper than
  // diffing label/badge children.
  useEffect(() => {
    if (!mapRef.current || !mapReady || !livePosition) return;

    // The live marker is this browser's geolocation + connection-quality pulse.
    // It is no longer bound to a Device row (browser-as-device was retired in
    // F2 Phase B), so it carries no name or click target.
    const info: LiveMarkerInfo = {
      name: null,
      latencyMs: metrics?.latency ?? null,
      downMbps: metrics?.bandwidthDown ?? null,
      upMbps: metrics?.bandwidthUp ?? null,
      onClick: undefined,
    };

    liveMarkerRef.current?.remove();
    const el = createLiveMarkerElement(info);
    liveMarkerRef.current = new maplibregl.Marker({ element: el })
      .setLngLat(livePosition)
      .addTo(mapRef.current);
  }, [mapReady, livePosition, metrics]);

  const scheduleViewportLoad = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void loadViewport();
    }, VIEWPORT_DEBOUNCE_MS);
  }, [selectedFloor]);

  const loadViewport = useCallback(async () => {
    if (!mapRef.current) return;
    const bounds = mapRef.current.getBounds();
    const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    try {
      const [devRes, fiberRes] = await Promise.all([
        api.get<{ success: true; data: { items: DeviceDto[] } }>('/map/devices', {
          params: { bbox, ...(selectedFloor !== null ? { floor: selectedFloor } : {}) },
          signal,
        }),
        api.get<{ success: true; data: { items: FiberRunDto[] } }>('/map/fiber-runs', {
          params: { bbox },
          signal,
        }),
      ]);

      upsertManyDevices(devRes.data.data.items);
      setFiberRuns(fiberRes.data.data.items);
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'CanceledError') return;
    }
  }, [selectedFloor, upsertManyDevices]);

  // Compute which devices to display
  const visibleDevices = useMemo(() => {
    if (!mapBounds || !mapReady) return [];

    return devices.filter((d) => {
      if (!d.latitude || !d.longitude) return false;

      // Bbox filter
      if (
        d.longitude < mapBounds.getWest() ||
        d.longitude > mapBounds.getEast() ||
        d.latitude < mapBounds.getSouth() ||
        d.latitude > mapBounds.getNorth()
      ) {
        return false;
      }

      // Zoom filter
      const config =
        DEVICE_CATEGORY_CONFIG[d.category as DeviceCategory] ?? DEVICE_CATEGORY_CONFIG.CUSTOM;
      if (currentZoom < config.minZoom) return false;

      // Layer toggle
      if (layerToggles[d.category as DeviceCategory] === false) return false;

      // Floor filter
      if (selectedFloor !== null && floorDisplayMode === 'single' && d.floor !== selectedFloor) {
        return false;
      }

      return true;
    });
  }, [devices, mapBounds, mapReady, currentZoom, layerToggles, selectedFloor, floorDisplayMode]);

  // Sync markers with visibleDevices
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;

    const currentIds = new Set(visibleDevices.map((d) => d.id));

    // Remove stale markers
    markersRef.current.forEach((entry, id) => {
      if (!currentIds.has(id)) {
        entry.marker.remove();
        markersRef.current.delete(id);
      }
    });

    // Add / update markers
    visibleDevices.forEach((device) => {
      if (!device.latitude || !device.longitude) return;
      const isSelected = device.id === selectedDeviceId;
      const existing = markersRef.current.get(device.id);

      if (existing) {
        existing.marker.setLngLat([device.longitude, device.latitude]);
        updateDeviceMarkerSelected(existing.el, isSelected);
      } else {
        const el = createDeviceMarkerElement(device, isSelected, () => onDeviceClick(device));
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([device.longitude, device.latitude])
          .addTo(mapRef.current!);
        markersRef.current.set(device.id, { marker, el });
      }
    });
  }, [visibleDevices, mapReady, selectedDeviceId, onDeviceClick]);

  // Update selected marker style when selection changes
  useEffect(() => {
    markersRef.current.forEach(({ el }, id) => {
      updateDeviceMarkerSelected(el, id === selectedDeviceId);
    });
  }, [selectedDeviceId]);

  // Sync fiber run GeoJSON layer
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    const map = mapRef.current;

    const features = buildFiberGeoJson(fiberRuns, devices);

    if (map.getSource(FIBER_SOURCE_ID)) {
      (map.getSource(FIBER_SOURCE_ID) as maplibregl.GeoJSONSource).setData({
        type: 'FeatureCollection',
        features,
      });
    } else {
      map.addSource(FIBER_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });

      map.addLayer({
        id: FIBER_LAYER_ID,
        type: 'line',
        source: FIBER_SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#f97316',
          'line-width': 2,
          'line-dasharray': [2, 2],
          'line-opacity': 0.8,
        },
        minzoom: 13,
      });
    }
  }, [fiberRuns, devices, mapReady]);

  // Override OpenFreeMap's near-imperceptible default building paint so the
  // 'building' layer is actually visible. Liberty's defaults are hsl(35,8%,85%)
  // fill with a near-identical outline — present in the tiles but invisible
  // against the basemap.
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    const map = mapRef.current;
    if (!map.getLayer('building')) return;
    map.setPaintProperty('building', 'fill-color', 'hsl(35,12%,78%)');
    map.setPaintProperty('building', 'fill-outline-color', 'hsl(35,15%,55%)');
  }, [mapReady]);

  // Show or hide the OpenFreeMap building layer based on the user toggle.
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    const map = mapRef.current;
    if (!map.getLayer('building')) return;
    map.setLayoutProperty('building', 'visibility', buildingsVisible ? 'visible' : 'none');
  }, [mapReady, buildingsVisible]);

  // Dimming for non-selected floors in "all" / "connection" mode
  useEffect(() => {
    markersRef.current.forEach(({ el }, id) => {
      const device = devices.find((d) => d.id === id);
      if (!device) return;
      const dimmed =
        selectedFloor !== null &&
        floorDisplayMode !== 'single' &&
        device.floor !== selectedFloor;
      el.style.opacity = dimmed ? '0.3' : '1';
    });
  }, [selectedFloor, floorDisplayMode, devices]);

  // Derived data for child UI components
  const availableFloors = useMemo(() => {
    const floors = new Set<number>();
    devices.forEach((d) => {
      if (d.floor !== null) floors.add(d.floor);
    });
    return Array.from(floors).sort((a, b) => a - b);
  }, [devices]);

  const floorLabels = useMemo(() => {
    const map: Record<number, string | null> = {};
    devices.forEach((d) => {
      if (d.floor !== null) map[d.floor] = d.floorLabel;
    });
    return map;
  }, [devices]);

  return (
    <View style={styles.root}>
      {/* MapLibre container. Uses flex:1 (not absoluteFill) because MapLibre's
          own stylesheet forces `.maplibregl-map { position: relative }` and
          beats RN-Web's class-based absolute positioning on source-order
          tiebreak — collapsing the box to its intrinsic height. */}
      <View nativeID={MAP_CONTAINER_ID} style={styles.mapContainer} />

      {/* Tile unavailability banner — device markers still render without tiles */}
      {tileError && (
        <View style={styles.tileErrorBanner}>
          <Text style={styles.tileErrorText}>
            Map tiles unavailable — device markers still shown
          </Text>
        </View>
      )}

      {/* Floor selector — right side */}
      {availableFloors.length > 0 && (
        <View style={styles.floorSelector}>
          <FloorSelector floors={availableFloors} floorLabels={floorLabels} />
        </View>
      )}

      {/* Map controls — bottom left */}
      <View style={styles.mapControls}>
        <MapControls currentZoom={currentZoom} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  mapContainer: {
    flex: 1,
  },
  floorSelector: {
    position: 'absolute',
    right: 12,
    top: 80,
  },
  mapControls: {
    position: 'absolute',
    left: 12,
    bottom: 24,
  },
  tileErrorBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(245, 158, 11, 0.9)',
    paddingVertical: 4,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  tileErrorText: {
    fontSize: 12,
    color: '#78350f',
    fontWeight: '500',
  },
});

function resolveInitialCenter(
  storedCenter: [number, number] | null,
  user: { homeLatitude?: number | null; homeLongitude?: number | null } | null,
): { center: [number, number]; zoom: number } {
  if (storedCenter) return { center: storedCenter, zoom: 13 };

  const lat = user?.homeLatitude;
  const lng = user?.homeLongitude;
  if (lat && lng) return { center: [lng as number, lat as number], zoom: 13 };

  return { center: [0, 0], zoom: 2 };
}

function buildFiberGeoJson(
  fiberRuns: FiberRunDto[],
  devices: DeviceDto[],
): GeoJSON.Feature<GeoJSON.LineString>[] {
  const deviceMap = new Map(devices.map((d) => [d.id, d]));

  return fiberRuns.flatMap((run) => {
    const start = deviceMap.get(run.startDeviceId);
    const end = deviceMap.get(run.endDeviceId);
    if (!start?.latitude || !start.longitude || !end?.latitude || !end.longitude) return [];

    return [
      {
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [start.longitude, start.latitude],
            [end.longitude, end.latitude],
          ],
        },
        properties: { id: run.id, name: run.name },
      },
    ];
  });
}

export default MapView;
