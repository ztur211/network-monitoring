import { View, Text, TouchableOpacity } from 'react-native';

const FREE_TIER_LIMIT = 50;
const WARNING_THRESHOLD = 45;

interface DeviceLimitBannerProps {
  deviceCount: number;
  onDismiss?: () => void;
}

export function DeviceLimitBanner({ deviceCount, onDismiss }: DeviceLimitBannerProps) {
  if (deviceCount < WARNING_THRESHOLD) return null;

  const atLimit = deviceCount >= FREE_TIER_LIMIT;

  return (
    <View
      className={`mx-4 mt-2 px-4 py-3 rounded-xl flex-row items-center justify-between ${
        atLimit
          ? 'bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700'
          : 'bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700'
      }`}
    >
      <View className="flex-1 mr-2">
        <Text
          className={`text-sm font-semibold ${
            atLimit ? 'text-red-800 dark:text-red-200' : 'text-yellow-800 dark:text-yellow-200'
          }`}
        >
          {atLimit
            ? `Device limit reached (${deviceCount}/${FREE_TIER_LIMIT})`
            : `Approaching device limit (${deviceCount}/${FREE_TIER_LIMIT})`}
        </Text>
        {atLimit && (
          <Text
            className="text-xs text-red-600 dark:text-red-400 mt-0.5"
          >
            No new devices can be added on the free plan.
          </Text>
        )}
      </View>
      {onDismiss && (
        <TouchableOpacity onPress={onDismiss}>
          <Text
            className={`text-lg ${
              atLimit ? 'text-red-400 dark:text-red-500' : 'text-yellow-400 dark:text-yellow-500'
            }`}
          >
            ✕
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
