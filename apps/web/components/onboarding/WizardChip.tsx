import { TouchableOpacity, Text } from 'react-native';
import type { OnboardingChip } from '@nodescope/shared';

interface Props {
  chip: OnboardingChip;
  disabled?: boolean;
  onPress: (value: string) => void;
}

export function WizardChip({ chip, disabled, onPress }: Props) {
  return (
    <TouchableOpacity
      onPress={() => onPress(chip.value)}
      disabled={disabled}
      className={`rounded-full px-4 py-2 border ${
        disabled
          ? 'bg-gray-100 border-gray-200 dark:bg-gray-800 dark:border-gray-700'
          : 'bg-white border-blue-600 dark:bg-gray-900'
      }`}
    >
      <Text
        className={`text-sm font-medium ${
          disabled ? 'text-gray-400' : 'text-blue-600'
        }`}
      >
        {chip.label}
      </Text>
    </TouchableOpacity>
  );
}
