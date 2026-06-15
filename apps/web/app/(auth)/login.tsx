import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authClient } from '../../lib/auth-client';
import { useAuthStore } from '../../store/auth.store';
import type { SessionUser } from '@nodescope/shared';
import { safeDesktopReturnTo } from '../../lib/safe-desktop-return';

const schema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type FormData = z.infer<typeof schema>;

export default function LoginScreen() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const setLoading = useAuthStore((s) => s.setLoading);
  const [error, setError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (data: FormData) => {
    setError(null);
    const result = await authClient.signIn.email({
      email: data.email,
      password: data.password,
    });

    if (result.error) {
      setError(result.error.message ?? 'Sign in failed. Check your email and password.');
      return;
    }

    if (result.data?.user) {
      setLoading(false);
      setUser(result.data.user as SessionUser);
      const apiOrigin = new URL(process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').origin;
      const raw =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('returnTo')
          : null;
      const returnTo = safeDesktopReturnTo(raw, apiOrigin);
      if (returnTo) {
        window.location.href = returnTo;
        return;
      }
      router.replace('/(app)/map');
    }
  };

  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-gray-900 px-6">
      <Text className="text-2xl font-bold text-gray-900 dark:text-white mb-8">Sign In</Text>

      {error && (
        <View className="w-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 mb-4">
          <Text className="text-red-600 dark:text-red-400 text-sm">{error}</Text>
        </View>
      )}

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
              placeholder="Password"
              placeholderTextColor="#9ca3af"
              onChangeText={onChange}
              value={value}
              secureTextEntry
              autoComplete="current-password"
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
          <Text className="text-white font-semibold text-base">Sign In</Text>
        )}
      </Pressable>

      <Pressable onPress={() => router.push('/(auth)/register')} className="mt-6">
        <Text className="text-blue-600 dark:text-blue-400 text-sm">
          Don't have an account? <Text className="font-semibold">Sign up</Text>
        </Text>
      </Pressable>
    </View>
  );
}
