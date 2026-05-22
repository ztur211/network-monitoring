import { View, Text } from 'react-native';
import type { OnboardingMessage } from '../../store/onboarding.store';

interface Props {
  message: OnboardingMessage;
}

export function WizardMessage({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <View className={`mb-3 ${isUser ? 'items-end' : 'items-start'}`}>
      <View
        className={`rounded-2xl px-4 py-3 ${
          isUser ? 'bg-blue-600' : 'bg-gray-100 dark:bg-gray-800'
        }`}
        style={{ maxWidth: '80%' }}
      >
        <Text
          className={`text-sm leading-5 ${
            isUser ? 'text-white' : 'text-gray-900 dark:text-gray-100'
          }`}
        >
          {message.content}
        </Text>
      </View>
    </View>
  );
}
