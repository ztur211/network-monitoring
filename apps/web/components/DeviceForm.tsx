import { useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useForm, Controller, Control, FieldValues } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { DeviceDto, DeviceCategory } from '@nodescope/shared';
import { CreateDeviceInput, UpdateDeviceInput } from '../store/device.store';

const DEVICE_CATEGORIES: DeviceCategory[] = [
  'ROUTER', 'SWITCH', 'ACCESS_POINT', 'FIREWALL', 'MODEM', 'ONT', 'RAD', 'DSLAM',
  'FIBER_MEDIA_CONVERTER', 'WIFI_EXTENDER', 'WIRELESS_BRIDGE', 'SERVER_RACK',
  'PATCH_PANEL', 'UPS', 'COMPUTER', 'PHONE', 'TABLET', 'PRINTER', 'IOT_DEVICE', 'CUSTOM',
];

// Lat/lng are captured from a map click before the form opens (see
// apps/web/app/(app)/map.tsx placement-mode flow). They're not in the schema
// because the user never types them — pencil-and-paper coordinate entry isn't
// part of the supported UX.
const schema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  category: z.string().min(1, 'Category is required'),
  floor: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined))
    .refine((v) => v === undefined || (!isNaN(v) && v >= -10 && v <= 200), 'Must be -10 to 200'),
  floorLabel: z.string().max(50).optional(),
  ipAddress: z
    .string()
    .optional()
    .refine(
      (v) => !v || /^(\d{1,3}\.){3}\d{1,3}$/.test(v),
      'Must be a valid IPv4 address',
    ),
  macAddress: z
    .string()
    .optional()
    .refine(
      (v) => !v || /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(v),
      'Must be XX:XX:XX:XX:XX:XX format',
    ),
  notes: z.string().max(500).optional(),
});

type FormValues = z.input<typeof schema>;

interface DeviceFormProps {
  device?: DeviceDto | null;
  // For create: lat/lng captured from the placement-mode map click.
  // For edit: normally omitted (the existing device.latitude/longitude render).
  // Provided again when the user invokes "Tap to relocate" and picks fresh
  // coords on the map — the form then re-opens prefilled with the new value.
  placedLatitude?: number | null;
  placedLongitude?: number | null;
  isSubmitting?: boolean;
  // Edit-mode "Tap to relocate" handler. When set, a button renders next to
  // the read-only coord row; pressing it returns control to the map screen,
  // which closes the form, enters placement mode, captures a tap, and
  // re-opens the form with placedLatitude/Longitude reflecting the new pick.
  onRelocate?: () => void;
  onClose: () => void;
  onSubmit: (input: CreateDeviceInput | UpdateDeviceInput) => Promise<void>;
}

function formatCoord(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  const latStr = `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}`;
  const lngStr = `${Math.abs(lng).toFixed(5)}° ${lng >= 0 ? 'E' : 'W'}`;
  return `${latStr}, ${lngStr}`;
}

export function DeviceForm({
  device,
  placedLatitude,
  placedLongitude,
  isSubmitting,
  onRelocate,
  onClose,
  onSubmit,
}: DeviceFormProps) {
  const isEdit = !!device;

  // For create: use the captured coords from the map click.
  // For edit: keep the device's existing coords; placedLatitude/Longitude
  // would override only when "Move on map" feeds new coords back in.
  const effectiveLatitude = placedLatitude ?? device?.latitude ?? null;
  const effectiveLongitude = placedLongitude ?? device?.longitude ?? null;
  const coordLine = formatCoord(effectiveLatitude, effectiveLongitude);

  const {
    control: formControl,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      category: 'ROUTER',
    },
  });

  useEffect(() => {
    if (device) {
      reset({
        name: device.name,
        category: device.category,
        floor: device.floor !== null ? String(device.floor) : '',
        floorLabel: device.floorLabel ?? '',
        ipAddress: device.ipAddress ?? '',
        macAddress: device.macAddress ?? '',
        notes: device.notes ?? '',
      });
    } else {
      reset({ name: '', category: 'ROUTER' });
    }
  }, [device, reset]);

  const control = formControl as unknown as Control<FieldValues>;

  const handleFormSubmit = handleSubmit(async (values) => {
    const cleaned: CreateDeviceInput = {
      name: values.name,
      category: values.category,
      ...(effectiveLatitude !== null && { latitude: effectiveLatitude }),
      ...(effectiveLongitude !== null && { longitude: effectiveLongitude }),
      ...(values.floor !== undefined && { floor: values.floor as unknown as number }),
      ...(values.floorLabel && { floorLabel: values.floorLabel }),
      ...(values.ipAddress && { ipAddress: values.ipAddress }),
      ...(values.macAddress && { macAddress: values.macAddress }),
      ...(values.notes && { notes: values.notes }),
    };
    await onSubmit(cleaned);
  });

  return (
    <View className="absolute inset-0 bg-black/50 flex-1 justify-end">
      <View className="bg-white dark:bg-gray-900 rounded-t-2xl" style={{ maxHeight: '90%' }}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-4 border-b border-gray-200 dark:border-gray-700">
          <Text className="text-lg font-bold text-gray-900 dark:text-white">
            {isEdit ? 'Edit Device' : 'Add Device'}
          </Text>
          <TouchableOpacity onPress={onClose}>
            <Text className="text-2xl text-gray-400 dark:text-gray-500">✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView className="px-4" keyboardShouldPersistTaps="handled">
          <View className="py-4 gap-4">
            <FormField
              label="Name *"
              error={errors.name?.message}
              control={control}
              name="name"
              placeholder="e.g. Core Router"
            />

            {/* Category picker */}
            <View>
              <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Category *
              </Text>
              <Controller
                control={control}
                name="category"
                render={({ field: { value, onChange } }) => (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    className="flex-row"
                  >
                    {DEVICE_CATEGORIES.map((cat) => (
                      <TouchableOpacity
                        key={cat}
                        onPress={() => onChange(cat)}
                        className={`mr-2 px-3 py-1.5 rounded-full border ${
                          value === cat
                            ? 'bg-blue-600 border-blue-600'
                            : 'bg-transparent border-gray-300 dark:border-gray-600'
                        }`}
                      >
                        <Text
                          className={`text-sm ${
                            value === cat ? 'text-white font-medium' : 'text-gray-600 dark:text-gray-400'
                          }`}
                        >
                          {formatCategory(cat)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              />
              {errors.category && (
                <Text className="text-red-500 text-xs mt-1">{errors.category.message}</Text>
              )}
            </View>

            {/* Location is captured by tapping the map before the form opens —
                see placement-mode flow in app/(app)/map.tsx. No text inputs.
                In edit mode, "Tap to relocate" re-enters placement mode and
                re-opens this form with the new pick prefilled. */}
            <View>
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Location
                </Text>
                {isEdit && onRelocate && (
                  <TouchableOpacity onPress={onRelocate} disabled={isSubmitting}>
                    <Text
                      className={`text-sm font-medium ${
                        isSubmitting ? 'text-blue-300' : 'text-blue-600'
                      }`}
                    >
                      Tap to relocate
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <View className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-800">
                <Text className="text-sm text-gray-700 dark:text-gray-300">
                  {coordLine ?? 'Tap the map to place this device'}
                </Text>
              </View>
            </View>

            <View className="flex-row gap-3">
              <View className="flex-1">
                <FormField
                  label="Floor"
                  error={errors.floor?.message}
                  control={control}
                  name="floor"
                  placeholder="e.g. 1"
                  keyboardType="number-pad"
                />
              </View>
              <View className="flex-1">
                <FormField
                  label="Floor Label"
                  error={errors.floorLabel?.message}
                  control={control}
                  name="floorLabel"
                  placeholder="e.g. Main Level"
                />
              </View>
            </View>

            <FormField
              label="IP Address"
              error={errors.ipAddress?.message}
              control={control}
              name="ipAddress"
              placeholder="e.g. 192.168.1.1"
              keyboardType="numbers-and-punctuation"
            />

            <FormField
              label="MAC Address"
              error={errors.macAddress?.message}
              control={control}
              name="macAddress"
              placeholder="AA:BB:CC:DD:EE:FF"
              autoCapitalize="characters"
            />

            <View>
              <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Notes
              </Text>
              <Controller
                control={control}
                name="notes"
                render={({ field: { value, onChange, onBlur } }) => (
                  <TextInput
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    placeholder="Optional notes..."
                    placeholderTextColor="#9ca3af"
                    multiline
                    numberOfLines={3}
                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800"
                    style={{ minHeight: 72, textAlignVertical: 'top' }}
                  />
                )}
              />
              {errors.notes && (
                <Text className="text-red-500 text-xs mt-1">{errors.notes.message}</Text>
              )}
            </View>

            {/* Bottom padding for keyboard */}
            <View style={{ height: 20 }} />
          </View>
        </ScrollView>

        {/* Submit */}
        <View className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <TouchableOpacity
            onPress={handleFormSubmit}
            disabled={isSubmitting}
            className={`py-3 rounded-xl items-center ${
              isSubmitting ? 'bg-blue-400' : 'bg-blue-600'
            }`}
          >
            {isSubmitting ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-semibold text-base">
                {isEdit ? 'Save Changes' : 'Add Device'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function FormField({
  label,
  error,
  control,
  name,
  placeholder,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  error?: string;
  control: Control<FieldValues>;
  name: string;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad' | 'numbers-and-punctuation';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View>
      <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</Text>
      <Controller
        control={control}
        name={name as never}
        render={({ field: { value, onChange, onBlur } }) => (
          <TextInput
            value={value as string}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder={placeholder}
            placeholderTextColor="#9ca3af"
            keyboardType={keyboardType ?? 'default'}
            autoCapitalize={autoCapitalize ?? 'sentences'}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800"
          />
        )}
      />
      {error && <Text className="text-red-500 text-xs mt-1">{error}</Text>}
    </View>
  );
}

function formatCategory(category: string): string {
  const labels: Record<string, string> = {
    ROUTER: 'Router',
    SWITCH: 'Switch',
    ACCESS_POINT: 'Access Point',
    FIREWALL: 'Firewall',
    MODEM: 'Modem',
    ONT: 'ONT',
    RAD: 'RAD',
    DSLAM: 'DSLAM',
    FIBER_MEDIA_CONVERTER: 'Fiber Converter',
    WIFI_EXTENDER: 'Wi-Fi Extender',
    WIRELESS_BRIDGE: 'Wireless Bridge',
    SERVER_RACK: 'Server Rack',
    PATCH_PANEL: 'Patch Panel',
    UPS: 'UPS',
    COMPUTER: 'Computer',
    PHONE: 'Phone',
    TABLET: 'Tablet',
    PRINTER: 'Printer',
    IOT_DEVICE: 'IoT Device',
    CUSTOM: 'Custom',
  };
  return labels[category] ?? category;
}
