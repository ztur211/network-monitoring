import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { authClient } from '../../lib/auth-client';
import { useAuthStore } from '../../store/auth.store';
import type { SessionUser } from '@nodescope/shared';

export default function AppLayout() {
  const router = useRouter();
  const { isAuthenticated, isLoading, setUser, setLoading } = useAuthStore();

  useEffect(() => {
    // Verify session is still valid on every mount of the app route group
    authClient.getSession().then((result) => {
      if (result.data?.user) {
        setUser(result.data.user as SessionUser);
      } else {
        setUser(null);
        router.replace('/(auth)/login');
      }
      setLoading(false);
    }).catch(() => {
      setUser(null);
      setLoading(false);
      router.replace('/(auth)/login');
    });
  }, []);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-gray-900">
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
