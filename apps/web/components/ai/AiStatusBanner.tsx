import { View, Text } from 'react-native';
import { useAiStore } from '../../store/ai.store';

export function AiStatusBanner() {
  const { providerAvailable, usage } = useAiStore();

  if (!providerAvailable) {
    return (
      <View className="bg-amber-50 border-b border-amber-200 px-4 py-2">
        <Text className="text-xs text-amber-700 text-center">
          AI service temporarily unavailable — responses use your documented network data only
        </Text>
      </View>
    );
  }

  if (usage) {
    const hourlyPct = usage.hourlyLimit > 0 ? usage.hourlyUsed / usage.hourlyLimit : 0;
    const dailyPct = usage.dailyLimit > 0 ? usage.dailyUsed / usage.dailyLimit : 0;

    if (hourlyPct >= 1) {
      return (
        <View className="bg-red-50 border-b border-red-200 px-4 py-2">
          <Text className="text-xs text-red-700 text-center">
            Hourly message limit reached ({usage.hourlyUsed}/{usage.hourlyLimit}). Resets next hour.
          </Text>
        </View>
      );
    }

    if (dailyPct >= 1) {
      return (
        <View className="bg-red-50 border-b border-red-200 px-4 py-2">
          <Text className="text-xs text-red-700 text-center">
            Daily message limit reached ({usage.dailyUsed}/{usage.dailyLimit}). Resets at midnight.
          </Text>
        </View>
      );
    }

    if (hourlyPct >= 0.8 || dailyPct >= 0.8) {
      return (
        <View className="bg-yellow-50 border-b border-yellow-200 px-4 py-2">
          <Text className="text-xs text-yellow-700 text-center">
            {hourlyPct >= 0.8
              ? `${usage.hourlyUsed}/${usage.hourlyLimit} messages used this hour`
              : `${usage.dailyUsed}/${usage.dailyLimit} messages used today`}
          </Text>
        </View>
      );
    }
  }

  return null;
}
