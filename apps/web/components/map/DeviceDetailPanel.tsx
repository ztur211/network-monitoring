import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { DeviceDto } from '@nodescope/shared';

interface DeviceDetailPanelProps {
  device: DeviceDto;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function DeviceDetailPanel({ device, onClose, onEdit, onDelete }: DeviceDetailPanelProps) {
  return (
    <View
      className="absolute bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl"
      style={{ maxHeight: '60%' }}
    >
      {/* Handle */}
      <View className="items-center pt-3 pb-1">
        <View className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
      </View>

      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <View className="flex-1 mr-3">
          <Text className="text-lg font-bold text-gray-900 dark:text-white" numberOfLines={1}>
            {device.name}
          </Text>
          <Text className="text-sm text-gray-500 dark:text-gray-400">
            {formatCategory(device.category)}
            {device.floor !== null ? ` · Floor ${device.floorLabel ?? device.floor}` : ''}
          </Text>
        </View>
        <TouchableOpacity onPress={onClose} className="p-1">
          <Text className="text-2xl text-gray-400 dark:text-gray-500">✕</Text>
        </TouchableOpacity>
      </View>

      {/* Body */}
      <ScrollView className="px-4 py-3">
        {device.ipAddress && (
          <DetailRow label="IP Address" value={device.ipAddress} />
        )}
        {device.macAddress && (
          <DetailRow label="MAC Address" value={device.macAddress} />
        )}
        {device.latitude !== null && device.longitude !== null && (
          <DetailRow
            label="Location"
            value={`${device.latitude.toFixed(6)}, ${device.longitude.toFixed(6)}`}
          />
        )}
        {device.notes && (
          <DetailRow label="Notes" value={device.notes} multiline />
        )}
        <DetailRow label="Version" value={String(device.version)} />
        <DetailRow
          label="Added"
          value={new Date(device.createdAt).toLocaleDateString()}
        />
      </ScrollView>

      {/* Actions */}
      <View className="flex-row gap-3 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
        <TouchableOpacity
          onPress={onEdit}
          className="flex-1 bg-blue-600 py-2 rounded-lg items-center"
        >
          <Text className="text-white font-semibold">Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDelete}
          className="flex-1 bg-red-500 py-2 rounded-lg items-center"
        >
          <Text className="text-white font-semibold">Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function DetailRow({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <View className="mb-3">
      <Text className="text-xs text-gray-400 dark:text-gray-500 uppercase font-semibold mb-0.5">
        {label}
      </Text>
      <Text
        className="text-sm text-gray-900 dark:text-white"
        numberOfLines={multiline ? undefined : 1}
      >
        {value}
      </Text>
    </View>
  );
}

function formatCategory(category: string): string {
  return category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
