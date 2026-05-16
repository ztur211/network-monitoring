// Only file in the codebase that imports maplibre-gl.
// All other components access map functionality through this component's props.
import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import maplibregl from 'maplibre-gl';

import { DeviceDto, FiberRunDto, DeviceCategory, DEVICE_CATEGORY_CONFIG } from '@nodescope/shared';
import { useDeviceStore } from '../../store/device.store';
import { useUiStore } from '../../store/ui.store';
import { useAuthStore } from '../../store/auth.store';
import { api } from '../../lib/api.service';
import { createDeviceMarkerElement, updateDeviceMarkerSelected } from './DeviceMarker';
import { createLiveMarkerElement } from './LiveMarker';
import { FloorSelector } from './FloorSelector';
import { MapControls } from './MapControls';

const TILE_STYLE_URL =
  process.env.EXPO_PUBLIC_MAP_TILE_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty';

const MAP_CONTAINER_ID = 'ns-map-container';
const VIEWPORT_DEBOUNCE_MS = 300;
const FIBER_SOURCE_ID = 'ns-fiber-runs';
const FIBER_LAYER_ID = 'ns-fiber-layer';

interface MapViewProps {
  onDeviceClick: (device: DeviceDto) => void;
  selectedDeviceId?: string | null;
}

export function MapView({ onDeviceClick, selectedDeviceId }: MapViewProps) {
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

  const { devices, upsertDevice } = useDeviceStore();
  const { mapCenter, mapZoom, layerToggles, selectedFloor, floorDisplayMode, setMapCenter, setMapZoom } =
    useUiStore();
  const user = useAuthStore((s) => s.user);

  // Inject MapLibre CSS once
  useEffect(() => {
    if (document.getElementById('maplibre-gl-css')) return;
    const link = document.createElement('link');
    link.id = 'maplibre-gl-css';
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
    document.head.appendChild(link);
  }, []);

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

    mapRef.current.on('zoom', () => {
      setCurrentZoom(mapRef.current!.getZoom());
    });

    mapRef.current.on('error', (e) => {
      if (e.error?.message?.includes('Failed to fetch') || (e as { tile?: unknown }).tile) {
        setTileError(true);
      }
    });

    // Live marker via geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        if (!mapRef.current) return;
        const el = createLiveMarkerElement();
        liveMarkerRef.current = new maplibregl.Marker({ element: el })
          .setLngLat([pos.coords.longitude, pos.coords.latitude])
          .addTo(mapRef.current);
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

      devRes.data.data.items.forEach((d) => upsertDevice(d));
      setFiberRuns(fiberRes.data.data.items);
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'CanceledError') return;
    }
  }, [selectedFloor, upsertDevice]);

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
    <View style={StyleSheet.absoluteFill}>
      {/* MapLibre container */}
      <View nativeID={MAP_CONTAINER_ID} style={StyleSheet.absoluteFill} />

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
