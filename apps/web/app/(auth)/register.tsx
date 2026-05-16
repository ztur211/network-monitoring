import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authClient } from '../../lib/auth-client';
import { useAuthStore } from '../../store/auth.store';
import type { SessionUser } from '@nodescope/shared';

const schema = z.object({
  name: z.string().max(100).optional(),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

type FormData = z.infer<typeof schema>;

export default function RegisterScreen() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const setLoading = useAuthStore((s) => s.setLoading);
  const [error, setError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setError(null);
    const result = await authClient.signUp.email({
      email: data.email,
      password: data.password,
      name: data.name ?? '',
    });

    if (result.error) {
      setError(result.error.message ?? 'Sign up failed. Please try again.');
      return;
    }

    if (result.data?.user) {
      setLoading(false);
      setUser(result.data.user as SessionUser);
      router.replace('/(app)/map');
    }
  };

  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-gray-900 px-6">
      <Text className="text-2xl font-bold text-gray-900 dark:text-white mb-8">Create Account</Text>

      {error && (
        <View className="w-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 mb-4">
          <Text className="text-red-600 dark:text-red-400 text-sm">{error}</Text>
        </View>
      )}

      <Controller
        control={control}
        name="name"
        render={({ field: { onChange, value }, fieldState: { error: fieldError } }) => (
          <View className="w-full mb-4">
            <TextInput
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 text-gray-900 dark:text-white bg-white dark:bg-gray-800"
              placeholder="Name (optional)"
              placeholderTextColor="#9ca3af"
              onChangeText={onChange}
              value={value}
              autoComplete="name"
            />
            {fieldError && (
              <Text className="text-red-500 text-xs mt-1">{fieldError.message}</Text>
            )}
          </View>
        )}
      />

      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, value }, fieldState: { error: fieldError } }) => (
          <View className="w-full mb-4">
            <TextInput
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 text-gray-900 dark:text-white bg-white dark:bg-gray-800"
              placeholder="Email"
              placeholderTextColor="#9ca3af"
              onChangeText={onChange}
              value={value}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
            {fieldError && (
              <Text className="text-red-500 text-xs mt-1">{fieldError.message}</Text>
            )}
          </View>
        )}
      />

      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, value }, fieldState: { error: fieldError } }) => (
          <View className="w-full mb-6">
            <TextInput
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 text-gray-900 dark:text-white bg-white dark:bg-gray-800"
              placeholder="Password (min 8 characters)"
              placeholderTextColor="#9ca3af"
              onChangeText={onChange}
              value={value}
              secureTextEntry
              autoComplete="new-password"
            />
            {fieldError && (
              <Text className="text-red-500 text-xs mt-1">{fieldError.message}</Text>
            )}
          </View>
        )}
      />

      <Pressable
        onPress={handleSubmit(onSubmit)}
        disabled={isSubmitting}
        className="w-full bg-blue-600 rounded-lg py-3 items-center active:bg-blue-700 disabled:opacity-60"
      >
        {isSubmitting ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text className="text-white font-semibold text-base">Create Account</Text>
        )}
      </Pressable>

      <Pressable onPress={() => router.push('/(auth)/login')} className="mt-6">
        <Text className="text-blue-600 dark:text-blue-400 text-sm">
          Already have an account? <Text className="font-semibold">Sign in</Text>
        </Text>
      </Pressable>
    </View>
  );
}
