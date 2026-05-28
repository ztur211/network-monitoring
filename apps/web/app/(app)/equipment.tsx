import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { DeviceDto, DeviceCategory } from '@nodescope/shared';
import { useDeviceStore, CreateDeviceInput, UpdateDeviceInput } from '../../store/device.store';
import { DeviceForm } from '../../components/DeviceForm';
import { DeviceLimitBanner } from '../../components/map/DeviceLimitBanner';
import { Timestamp } from '../../components/Timestamp';

const CATEGORY_GROUPS: { label: string; values: DeviceCategory[] }[] = [
  { label: 'All', values: [] },
  { label: 'ISP', values: ['RAD', 'ONT', 'DSLAM'] },
  { label: 'Core', values: ['ROUTER', 'MODEM', 'FIBER_MEDIA_CONVERTER', 'FIREWALL'] },
  {
    label: 'Network',
    values: ['SWITCH', 'ACCESS_POINT', 'WIFI_EXTENDER', 'WIRELESS_BRIDGE', 'SERVER_RACK', 'PATCH_PANEL', 'UPS'],
  },
  { label: 'End-User', values: ['COMPUTER', 'PHONE', 'TABLET', 'PRINTER', 'IOT_DEVICE'] },
  { label: 'Custom', values: ['CUSTOM'] },
];

type FormMode = 'create' | 'edit' | null;

export default function EquipmentScreen() {
  const { devices, isLoading, loadedAt, error, loadDevices, createDevice, updateDevice, deleteDevice } =
    useDeviceStore();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<DeviceCategory[]>([]);
  const [floorFilter, setFloorFilter] = useState<number | null>(null);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editDevice, setEditDevice] = useState<DeviceDto | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void loadDevices();
  }, []);

  const availableFloors = useMemo(() => {
    const floors = new Set<number>();
    devices.forEach((d) => {
      if (d.floor !== null) floors.add(d.floor);
    });
    return Array.from(floors).sort((a, b) => a - b);
  }, [devices]);

  const filtered = useMemo(() => {
    return devices.filter((d) => {
      if (search && !d.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (categoryFilter.length > 0 && !categoryFilter.includes(d.category as DeviceCategory))
        return false;
      if (floorFilter !== null && d.floor !== floorFilter) return false;
      return true;
    });
  }, [devices, search, categoryFilter, floorFilter]);

  const handleDelete = useCallback(
    async (device: DeviceDto) => {
      // RN-Web Alert.alert is a stub — see comment in map.tsx handleDelete.
      const confirmed = typeof window !== 'undefined' && window.confirm(
        `Delete "${device.name}"? This cannot be undone.`,
      );
      if (!confirmed) return;
      try {
        await deleteDevice(device.id);
      } catch {
        if (typeof window !== 'undefined') {
          window.alert('Failed to delete device.');
        }
      }
    },
    [deleteDevice],
  );

  const handleFormSubmit = useCallback(
    async (input: CreateDeviceInput | UpdateDeviceInput) => {
      setIsSubmitting(true);
      try {
        if (formMode === 'create') {
          await createDevice(input as CreateDeviceInput);
        } else if (formMode === 'edit' && editDevice) {
          await updateDevice(editDevice.id, editDevice, input as UpdateDeviceInput);
        }
        setFormMode(null);
        setEditDevice(null);
      } catch {
        if (typeof window !== 'undefined') {
          window.alert('Failed to save device. Queued for retry.');
        }
        setFormMode(null);
        setEditDevice(null);
      } finally {
        setIsSubmitting(false);
      }
    },
    [formMode, editDevice, createDevice, updateDevice],
  );

  const renderDevice = useCallback(
    ({ item }: { item: DeviceDto }) => (
      <DeviceCard
        device={item}
        onEdit={() => {
          setEditDevice(item);
          setFormMode('edit');
        }}
        onDelete={() => handleDelete(item)}
      />
    ),
    [handleDelete],
  );

  if (isLoading && devices.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-gray-900">
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (error && devices.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-gray-900 px-8">
        <Text className="text-red-500 dark:text-red-400 text-center mb-4">{error}</Text>
        <TouchableOpacity
          onPress={() => void loadDevices()}
          className="bg-blue-600 px-6 py-2 rounded-lg"
        >
          <Text className="text-white font-medium">Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-gray-900">
      {/* Header */}
      <View className="px-4 pt-12 pb-2 border-b border-gray-200 dark:border-gray-700">
        <View className="flex-row items-center justify-between mb-3">
          <View>
            <Text className="text-2xl font-bold text-gray-900 dark:text-white">Equipment</Text>
            <Timestamp isoTimestamp={loadedAt} staleThresholdMs={300_000} />
          </View>
          <TouchableOpacity
            onPress={() => setFormMode('create')}
            className="bg-blue-600 px-4 py-2 rounded-lg"
          >
            <Text className="text-white font-medium">+ Add</Text>
          </TouchableOpacity>
        </View>

        {/* Search */}
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search devices..."
          placeholderTextColor="#9ca3af"
          className="bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white mb-3"
        />

        {/* Category filter chips */}
        <View className="flex-row gap-2 mb-2 flex-wrap">
          {CATEGORY_GROUPS.map((group) => {
            const isActive =
              group.values.length === 0
                ? categoryFilter.length === 0
                : group.values.some((v) => categoryFilter.includes(v));
            return (
              <TouchableOpacity
                key={group.label}
                onPress={() =>
                  setCategoryFilter(
                    group.values.length === 0
                      ? []
                      : isActive
                      ? categoryFilter.filter((c) => !group.values.includes(c))
                      : [...categoryFilter, ...group.values],
                  )
                }
                className={`px-3 py-1 rounded-full border ${
                  isActive
                    ? 'bg-blue-600 border-blue-600'
                    : 'bg-transparent border-gray-300 dark:border-gray-600'
                }`}
              >
                <Text
                  className={`text-xs font-medium ${
                    isActive ? 'text-white' : 'text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {group.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Floor filter */}
        {availableFloors.length > 0 && (
          <View className="flex-row gap-2 flex-wrap">
            <TouchableOpacity
              onPress={() => setFloorFilter(null)}
              className={`px-3 py-1 rounded-full border ${
                floorFilter === null
                  ? 'bg-blue-600 border-blue-600'
                  : 'bg-transparent border-gray-300 dark:border-gray-600'
              }`}
            >
              <Text
                className={`text-xs font-medium ${
                  floorFilter === null ? 'text-white' : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                All floors
              </Text>
            </TouchableOpacity>
            {availableFloors.map((floor) => (
              <TouchableOpacity
                key={floor}
                onPress={() => setFloorFilter(floor === floorFilter ? null : floor)}
                className={`px-3 py-1 rounded-full border ${
                  floorFilter === floor
                    ? 'bg-blue-600 border-blue-600'
                    : 'bg-transparent border-gray-300 dark:border-gray-600'
                }`}
              >
                <Text
                  className={`text-xs font-medium ${
                    floorFilter === floor ? 'text-white' : 'text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {floor === 0 ? 'Ground' : `Floor ${floor}`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      <DeviceLimitBanner deviceCount={devices.length} />

      {/* Device list */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderDevice}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text className="text-gray-400 dark:text-gray-500 text-center">
              {devices.length === 0
                ? 'No devices yet. Add your first device.'
                : 'No devices match your filters.'}
            </Text>
          </View>
        }
      />

      {formMode && (
        <DeviceForm
          device={formMode === 'edit' ? editDevice : null}
          isSubmitting={isSubmitting}
          onClose={() => {
            setFormMode(null);
            setEditDevice(null);
          }}
          onSubmit={handleFormSubmit}
        />
      )}
    </View>
  );
}

function DeviceCard({
  device,
  onEdit,
  onDelete,
}: {
  device: DeviceDto;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <View className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
      <View className="flex-row items-start justify-between mb-1">
        <View className="flex-1 mr-2">
          <Text className="font-semibold text-gray-900 dark:text-white" numberOfLines={1}>
            {device.name}
          </Text>
          <Text className="text-xs text-gray-500 dark:text-gray-400">
            {formatCategory(device.category)}
            {device.floor !== null
              ? ` · ${device.floorLabel ?? (device.floor === 0 ? 'Ground' : `Floor ${device.floor}`)}`
              : ''}
          </Text>
        </View>
        <View className="flex-row gap-2">
          <TouchableOpacity
            onPress={onEdit}
            className="px-3 py-1 bg-blue-50 dark:bg-blue-900 rounded-lg"
          >
            <Text className="text-xs text-blue-600 dark:text-blue-400 font-medium">Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onDelete}
            className="px-3 py-1 bg-red-50 dark:bg-red-900 rounded-lg"
          >
            <Text className="text-xs text-red-500 dark:text-red-400 font-medium">Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View className="flex-row flex-wrap gap-x-4 gap-y-0.5 mt-1">
        {device.ipAddress && (
          <Text className="text-xs text-gray-500 dark:text-gray-400">{device.ipAddress}</Text>
        )}
        {device.latitude !== null && device.longitude !== null && (
          <Text className="text-xs text-gray-400 dark:text-gray-500">
            {device.latitude.toFixed(4)}, {device.longitude.toFixed(4)}
          </Text>
        )}
      </View>
    </View>
  );
}

function formatCategory(category: string): string {
  const labels: Record<string, string> = {
    ROUTER: 'Router', SWITCH: 'Switch', ACCESS_POINT: 'Access Point', FIREWALL: 'Firewall',
    MODEM: 'Modem', ONT: 'ONT', RAD: 'RAD', DSLAM: 'DSLAM',
    FIBER_MEDIA_CONVERTER: 'Fiber Converter', WIFI_EXTENDER: 'Wi-Fi Extender',
    WIRELESS_BRIDGE: 'Wireless Bridge', SERVER_RACK: 'Server Rack', PATCH_PANEL: 'Patch Panel',
    UPS: 'UPS', COMPUTER: 'Computer', PHONE: 'Phone', TABLET: 'Tablet',
    PRINTER: 'Printer', IOT_DEVICE: 'IoT Device', CUSTOM: 'Custom',
  };
  return labels[category] ?? category;
}
