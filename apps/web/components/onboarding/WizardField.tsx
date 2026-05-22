import { View, Text, TextInput } from 'react-native';
import type { OnboardingField } from '@nodescope/shared';

export type FieldValue = string;

interface Props {
  field: OnboardingField;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  disabled?: boolean;
}

const KEYBOARD_BY_KIND: Record<OnboardingField['kind'], 'default' | 'numeric'> = {
  text: 'default',
  mac: 'default',
  address: 'default',
  number: 'numeric',
  speeds: 'numeric',
};

const PLACEHOLDER_BY_KIND: Partial<Record<OnboardingField['kind'], string>> = {
  mac: 'XX:XX:XX:XX:XX:XX',
  address: '123 Maple Street, Springfield',
  number: '0',
};

export function WizardField({ field, value, onChange, disabled }: Props) {
  const placeholder = field.placeholder ?? PLACEHOLDER_BY_KIND[field.kind] ?? '';
  const keyboardType = KEYBOARD_BY_KIND[field.kind];

  return (
    <View className="mb-3">
      <Text className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
        {field.label}
        {field.required ? <Text className="text-red-500"> *</Text> : null}
      </Text>
      <TextInput
        className="bg-gray-100 dark:bg-gray-800 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-gray-100"
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        editable={!disabled}
        keyboardType={keyboardType}
        autoCapitalize={field.kind === 'mac' ? 'characters' : 'none'}
        autoCorrect={false}
      />
    </View>
  );
}
