import { View, Text } from 'react-native';
import { AiChatWindow } from '../../components/ai/AiChatWindow';

export default function AiAssistantScreen() {
  return (
    <View className="flex-1 bg-white dark:bg-gray-900">
      <View className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <Text className="text-xl font-semibold text-gray-900 dark:text-gray-100">AI Assistant</Text>
        <Text className="text-xs text-gray-500 mt-0.5">
          Knows your documented devices &amp; current browser metrics — not undiscovered devices
        </Text>
      </View>
      <AiChatWindow />
    </View>
  );
}
