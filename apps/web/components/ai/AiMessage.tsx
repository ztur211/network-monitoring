import { View, Text, ActivityIndicator } from 'react-native';
import type { AiMessage as AiMessageType } from '../../store/ai.store';

interface Props {
  message: AiMessageType;
}

export function AiMessage({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <View className={`mb-3 ${isUser ? 'items-end' : 'items-start'}`}>
      <View
        className={`max-w-xs rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-blue-600'
            : message.providerStatus === 'unavailable'
            ? 'bg-amber-50 border border-amber-200'
            : 'bg-gray-100 dark:bg-gray-800'
        }`}
        style={{ maxWidth: '80%' }}
      >
        {message.providerStatus === 'unavailable' && !isUser && (
          <Text className="text-xs text-amber-600 font-medium mb-1">
            AI service unavailable — showing network summary
          </Text>
        )}
        <Text
          className={`text-sm leading-5 ${
            isUser ? 'text-white' : 'text-gray-900 dark:text-gray-100'
          }`}
        >
          {message.content}
          {message.streaming && <ActivityIndicator size="small" color="#6b7280" style={{ marginLeft: 4 }} />}
        </Text>
        {message.usageWarning && (
          <Text className="text-xs text-amber-600 mt-1">{message.usageWarning}</Text>
        )}
      </View>
      <Text className="text-xs text-gray-400 mt-1 mx-1">
        {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
    </View>
  );
}
