import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CircuitDto } from '@nodescope/shared';
import { useDeviceStore } from '../store/device.store';
import type { CreateCircuitInput, UpdateCircuitInput } from '../store/circuits.store';

const schema = z.object({
  ispName: z.string().min(1, 'ISP name is required').max(100).trim(),
  circuitId: z.string().max(100).trim().optional(),
  serviceType: z.string().min(1, 'Service type is required').max(50).trim(),
  bandwidth: z.preprocess(
    (val) => (val === '' || val === undefined || val === null ? undefined : Number(val)),
    z.number().min(0.1).max(100000).optional(),
  ),
  deviceId: z.string().uuid().nullable().optional(),
  notes: z.string().max(500).optional(),
});

type FormData = z.infer<typeof schema>;

interface CircuitFormProps {
  mode: 'create' | 'edit';
  circuit?: CircuitDto;
  onSubmit: (data: CreateCircuitInput | UpdateCircuitInput) => Promise<void>;
  onCancel: () => void;
  isSubmitting: boolean;
}

const SERVICE_TYPES = ['Fiber', 'Cable', 'DSL', 'Leased Line', 'Wireless', 'Other'];

export function CircuitForm({ mode, circuit, onSubmit, onCancel, isSubmitting }: CircuitFormProps) {
  const { devices } = useDeviceStore();

  const {
    control,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      ispName: circuit?.ispName ?? '',
      circuitId: circuit?.circuitId ?? '',
      serviceType: circuit?.serviceType ?? '',
      bandwidth: circuit?.bandwidth ?? undefined,
      deviceId: circuit?.deviceId ?? null,
      notes: circuit?.notes ?? '',
    },
  });

  const serviceTypeValue = watch('serviceType');
  const selectedDeviceId = watch('deviceId');

  const handleFormSubmit = handleSubmit(async (data) => {
    await onSubmit({
      ispName: data.ispName,
      circuitId: data.circuitId || undefined,
      serviceType: data.serviceType,
      bandwidth: data.bandwidth,
      deviceId: data.deviceId ?? null,
      notes: data.notes || undefined,
    });
  });

  return (
    <ScrollView className="flex-1 bg-white dark:bg-gray-900">
      <View className="px-4 pt-4 pb-8">
        <Text className="text-xl font-bold text-gray-900 dark:text-white mb-6">
          {mode === 'create' ? 'New Circuit' : 'Edit Circuit'}
        </Text>

        {/* ISP Name */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            ISP Name *
          </Text>
          <Controller
            control={control}
            name="ispName"
            render={({ field: { onChange, value } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                placeholder="e.g. Comcast Business"
                placeholderTextColor="#9ca3af"
                className="bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
              />
            )}
          />
          {errors.ispName && (
            <Text className="text-red-500 text-xs mt-1">{errors.ispName.message}</Text>
          )}
        </View>

        {/* Service Type */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Service Type *
          </Text>
          <View className="flex-row flex-wrap gap-2 mb-2">
            {SERVICE_TYPES.map((type) => {
              const isActive = serviceTypeValue === type;
              return (
                <TouchableOpacity
                  key={type}
                  onPress={() => setValue('serviceType', type)}
                  className={`px-3 py-1.5 rounded-full border ${
                    isActive
                      ? 'bg-blue-600 border-blue-600'
                      : 'bg-transparent border-gray-300 dark:border-gray-600'
                  }`}
                >
                  <Text
                    className={`text-sm ${
                      isActive ? 'text-white' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {type}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Controller
            control={control}
            name="serviceType"
            render={({ field: { onChange, value } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                placeholder="Or type a custom service type..."
                placeholderTextColor="#9ca3af"
                className="bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
              />
            )}
          />
          {errors.serviceType && (
            <Text className="text-red-500 text-xs mt-1">{errors.serviceType.message}</Text>
          )}
        </View>

        {/* Circuit ID */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Circuit ID
          </Text>
          <Controller
            control={control}
            name="circuitId"
            render={({ field: { onChange, value } }) => (
              <TextInput
                value={value ?? ''}
                onChangeText={onChange}
                placeholder="ISP-assigned circuit identifier (optional)"
                placeholderTextColor="#9ca3af"
                className="bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
              />
            )}
          />
        </View>

        {/* Bandwidth */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Bandwidth (Mbps)
          </Text>
          <Controller
            control={control}
            name="bandwidth"
            render={({ field: { onChange, value } }) => (
              <TextInput
                value={value?.toString() ?? ''}
                onChangeText={onChange}
                placeholder="e.g. 1000"
                placeholderTextColor="#9ca3af"
                keyboardType="numeric"
                className="bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
              />
            )}
          />
          {errors.bandwidth && (
            <Text className="text-red-500 text-xs mt-1">{String(errors.bandwidth.message)}</Text>
          )}
        </View>

        {/* Associated Device */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Associated Device
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <TouchableOpacity
              onPress={() => setValue('deviceId', null)}
              className={`px-3 py-1.5 rounded-full border ${
                !selectedDeviceId
                  ? 'bg-blue-600 border-blue-600'
                  : 'bg-transparent border-gray-300 dark:border-gray-600'
              }`}
            >
              <Text
                className={`text-sm ${
                  !selectedDeviceId ? 'text-white' : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                None
              </Text>
            </TouchableOpacity>
            {devices.map((device) => {
              const isSelected = selectedDeviceId === device.id;
              return (
                <TouchableOpacity
                  key={device.id}
                  onPress={() => setValue('deviceId', device.id)}
                  className={`px-3 py-1.5 rounded-full border ${
                    isSelected
                      ? 'bg-blue-600 border-blue-600'
                      : 'bg-transparent border-gray-300 dark:border-gray-600'
                  }`}
                >
                  <Text
                    className={`text-sm ${
                      isSelected ? 'text-white' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {device.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
            Link to the device where this circuit terminates (e.g. your router).
          </Text>
        </View>

        {/* Notes */}
        <View className="mb-6">
          <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</Text>
          <Controller
            control={control}
            name="notes"
            render={({ field: { onChange, value } }) => (
              <TextInput
                value={value ?? ''}
                onChangeText={onChange}
                placeholder="Optional notes..."
                placeholderTextColor="#9ca3af"
                multiline
                numberOfLines={3}
                className="bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
                style={{ textAlignVertical: 'top', minHeight: 80 }}
              />
            )}
          />
        </View>

        {/* Actions */}
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={onCancel}
            className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg py-3 items-center"
          >
            <Text className="text-gray-700 dark:text-gray-300 font-medium">Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => void handleFormSubmit()}
            disabled={isSubmitting}
            className={`flex-1 rounded-lg py-3 items-center ${
              isSubmitting ? 'bg-blue-400' : 'bg-blue-600'
            }`}
          >
            <Text className="text-white font-medium">
              {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create Circuit' : 'Save Changes'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}
