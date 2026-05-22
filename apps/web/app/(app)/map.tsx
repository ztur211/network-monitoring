import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { DeviceDto, DeviceCategory, DEVICE_CATEGORY_CONFIG } from '@nodescope/shared';
import { useDeviceStore, CreateDeviceInput, UpdateDeviceInput } from '../../store/device.store';
import { DeviceDetailPanel } from '../../components/map/DeviceDetailPanel';
import { DeviceLimitBanner } from '../../components/map/DeviceLimitBanner';
import { OnHomeBadge } from '../../components/map/OnHomeBadge';
import { DeviceForm } from '../../components/DeviceForm';
import { Timestamp } from '../../components/Timestamp';

// Lazy-loaded so maplibre-gl (~780KB raw / ~200KB gzipped) lives in a separate
// chunk and only loads when the map screen is reached.
const MapView = lazy(() => import('../../components/map/MapView'));

type FormMode = 'create' | 'edit' | null;

export default function MapScreen() {
  const { devices, isLoading, loadedAt, loadDevices, createDevice, updateDevice, deleteDevice } =
    useDeviceStore();

  const [selectedDevice, setSelectedDevice] = useState<DeviceDto | null>(null);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editDevice, setEditDevice] = useState<DeviceDto | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [limitBannerDismissed, setLimitBannerDismissed] = useState(false);
  // Placement flow: 'idle' → 'placing' (FAB tapped, awaiting a map click) →
  // form opens with pickedCoords captured. The form's onClose returns to
  // 'idle' regardless of submit/cancel.
  const [placementMode, setPlacementMode] = useState<'idle' | 'placing'>('idle');
  const [pickedCoords, setPickedCoords] = useState<{ latitude: number; longitude: number } | null>(
    null,
  );
  // One-shot fly target. `key` is monotonically increasing so MapView re-runs
  // its fly even when consecutive devices happen to be at the same coords.
  const [flyTarget, setFlyTarget] = useState<{
    key: number;
    latitude: number;
    longitude: number;
    zoom?: number;
  } | null>(null);

  useEffect(() => {
    void loadDevices();
  }, []);

  const handleDeviceClick = useCallback((device: DeviceDto) => {
    setSelectedDevice(device);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedDevice(null);
  }, []);

  const handleEdit = useCallback(() => {
    if (!selectedDevice) return;
    setEditDevice(selectedDevice);
    setFormMode('edit');
    setSelectedDevice(null);
  }, [selectedDevice]);

  const handleDelete = useCallback(async () => {
    if (!selectedDevice) return;
    const device = selectedDevice;
    setSelectedDevice(null);

    // react-native-web's Alert.alert is a console.warn stub: it does not
    // show a dialog and never fires the button callbacks. The destructive
    // path therefore has to use window.confirm directly. Same swap is made
    // in equipment.tsx and circuits.tsx (search "window.confirm" for the
    // full set).
    const confirmed = typeof window !== 'undefined' && window.confirm(
      `Delete "${device.name}"? This cannot be undone.`,
    );
    if (!confirmed) return;

    try {
      await deleteDevice(device.id);
    } catch {
      if (typeof window !== 'undefined') {
        window.alert('Failed to delete device. It may have been re-queued for retry.');
      }
    }
  }, [selectedDevice, deleteDevice]);

  const handleFormClose = useCallback(() => {
    setFormMode(null);
    setEditDevice(null);
    setPickedCoords(null);
    setPlacementMode('idle');
  }, []);

  const handleStartPlacement = useCallback(() => {
    setPlacementMode('placing');
  }, []);

  const handleCancelPlacement = useCallback(() => {
    setPlacementMode('idle');
    setPickedCoords(null);
  }, []);

  const handleMapClick = useCallback(
    (lngLat: { longitude: number; latitude: number }) => {
      if (placementMode !== 'placing') return;
      setPickedCoords(lngLat);
      setPlacementMode('idle');
      setFormMode('create');
    },
    [placementMode],
  );

  const handleFormSubmit = useCallback(
    async (input: CreateDeviceInput | UpdateDeviceInput) => {
      setIsSubmitting(true);
      try {
        if (formMode === 'create') {
          const created = await createDevice(input as CreateDeviceInput);
          // Auto-zoom to where the user just placed the device. Each category
          // has a minZoom (DEVICE_CATEGORY_CONFIG) — markers don't render
          // below it. Without this fly, a user adding a COMPUTER (minZoom 18)
          // from zoom 13 wouldn't see the marker at all and would think the
          // create failed.
          if (created.latitude !== null && created.longitude !== null) {
            const config =
              DEVICE_CATEGORY_CONFIG[created.category as DeviceCategory] ??
              DEVICE_CATEGORY_CONFIG.CUSTOM;
            const targetZoom = Math.max(config.minZoom + 0.5, 13);
            setFlyTarget({
              key: Date.now(),
              latitude: created.latitude,
              longitude: created.longitude,
              zoom: targetZoom,
            });
          }
        } else if (formMode === 'edit' && editDevice) {
          await updateDevice(editDevice.id, editDevice, input as UpdateDeviceInput);
        }
        handleFormClose();
      } catch {
        Alert.alert('Error', 'Failed to save device. It has been queued for retry when reconnected.');
        handleFormClose();
      } finally {
        setIsSubmitting(false);
      }
    },
    [formMode, editDevice, createDevice, updateDevice, handleFormClose],
  );

  if (isLoading && devices.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-gray-900">
        <ActivityIndicator size="large" color="#2563eb" />
        <Text className="mt-3 text-gray-500 dark:text-gray-400">Loading your network...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1">
      {/* Map fills the screen. Lazy boundary keeps maplibre-gl out of the entry bundle. */}
      <Suspense
        fallback={
          <View className="absolute inset-0 items-center justify-center bg-slate-50">
            <ActivityIndicator size="large" color="#0f172a" />
            <Text className="mt-2 text-sm text-slate-500">Loading map…</Text>
          </View>
        }
      >
        <MapView
          onDeviceClick={handleDeviceClick}
          selectedDeviceId={selectedDevice?.id}
          placementMode={placementMode === 'placing'}
          onMapClick={handleMapClick}
          flyTo={flyTarget}
        />
      </Suspense>

      {/* Device limit banner */}
      {!limitBannerDismissed && (
        <View className="absolute top-0 left-0 right-0">
          <DeviceLimitBanner
            deviceCount={devices.length}
            onDismiss={() => setLimitBannerDismissed(true)}
          />
        </View>
      )}

      {/* Data freshness + on-home indicators, top-left. The OnHomeBadge hides
          itself when no network exists, so this row collapses to just the
          timestamp pre-onboarding. Right side stays clear for MapLibre's
          NavigationControl. */}
      <View
        className="absolute top-2 left-2 flex-row items-center gap-2"
        style={{ pointerEvents: 'none' }}
      >
        <Timestamp
          isoTimestamp={loadedAt}
          staleThresholdMs={300_000}
          className="bg-white/80 dark:bg-gray-900/80 rounded-full px-2 py-0.5"
        />
        <OnHomeBadge />
      </View>

      {/* Placement-mode banner */}
      {placementMode === 'placing' && (
        <View className="absolute top-12 left-1/2 -translate-x-1/2 bg-blue-600 rounded-full px-4 py-2 shadow-lg flex-row items-center gap-3">
          <Text className="text-white text-sm font-medium">Tap the map to place a device</Text>
          <TouchableOpacity onPress={handleCancelPlacement}>
            <Text className="text-white text-xs underline">Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Add device FAB — enters placement mode rather than opening the form
          directly. Once the user taps the map, handleMapClick captures coords
          and flips to formMode='create'. */}
      {!formMode && !selectedDevice && placementMode === 'idle' && (
        <TouchableOpacity
          onPress={handleStartPlacement}
          className="absolute bottom-8 right-5 w-14 h-14 bg-blue-600 rounded-full shadow-xl items-center justify-center"
          style={{ elevation: 8 }}
        >
          <Text className="text-white text-3xl font-light leading-none">+</Text>
        </TouchableOpacity>
      )}

      {/* Device detail panel */}
      {selectedDevice && !formMode && (
        <DeviceDetailPanel
          device={selectedDevice}
          onClose={handleClosePanel}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      )}

      {/* Device form (create / edit) */}
      {formMode && (
        <DeviceForm
          device={formMode === 'edit' ? editDevice : null}
          placedLatitude={formMode === 'create' ? pickedCoords?.latitude ?? null : null}
          placedLongitude={formMode === 'create' ? pickedCoords?.longitude ?? null : null}
          isSubmitting={isSubmitting}
          onClose={handleFormClose}
          onSubmit={handleFormSubmit}
        />
      )}
    </View>
  );
}
