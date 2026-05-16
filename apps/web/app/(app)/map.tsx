import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { DeviceDto } from '@nodescope/shared';
import { useDeviceStore, CreateDeviceInput, UpdateDeviceInput } from '../../store/device.store';
import { MapView } from '../../components/map/MapView';
import { DeviceDetailPanel } from '../../components/map/DeviceDetailPanel';
import { DeviceLimitBanner } from '../../components/map/DeviceLimitBanner';
import { DeviceForm } from '../../components/DeviceForm';

type FormMode = 'create' | 'edit' | null;

export default function MapScreen() {
  const { devices, isLoading, loadDevices, createDevice, updateDevice, deleteDevice } =
    useDeviceStore();

  const [selectedDevice, setSelectedDevice] = useState<DeviceDto | null>(null);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editDevice, setEditDevice] = useState<DeviceDto | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [limitBannerDismissed, setLimitBannerDismissed] = useState(false);

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

    Alert.alert(
      'Delete Device',
      `Delete "${device.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDevice(device.id);
            } catch {
              Alert.alert('Error', 'Failed to delete device. It may have been re-queued for retry.');
            }
          },
        },
      ],
    );
  }, [selectedDevice, deleteDevice]);

  const handleFormClose = useCallback(() => {
    setFormMode(null);
    setEditDevice(null);
  }, []);

  const handleFormSubmit = useCallback(
    async (input: CreateDeviceInput | UpdateDeviceInput) => {
      setIsSubmitting(true);
      try {
        if (formMode === 'create') {
          await createDevice(input as CreateDeviceInput);
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
      {/* Map fills the screen */}
      <MapView
        onDeviceClick={handleDeviceClick}
        selectedDeviceId={selectedDevice?.id}
      />

      {/* Device limit banner */}
      {!limitBannerDismissed && (
        <View className="absolute top-0 left-0 right-0">
          <DeviceLimitBanner
            deviceCount={devices.length}
            onDismiss={() => setLimitBannerDismissed(true)}
          />
        </View>
      )}

      {/* Add device FAB */}
      {!formMode && !selectedDevice && (
        <TouchableOpacity
          onPress={() => setFormMode('create')}
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
          isSubmitting={isSubmitting}
          onClose={handleFormClose}
          onSubmit={handleFormSubmit}
        />
      )}
    </View>
  );
}
