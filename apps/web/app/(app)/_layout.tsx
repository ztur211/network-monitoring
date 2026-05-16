import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { authClient } from '../../lib/auth-client';
import { useAuthStore } from '../../store/auth.store';
import { websocketService } from '../../lib/websocket.service';
import { browserCollectorService, subscribeToMetricsUpdates } from '../../lib/browser-collector.service';
import { OfflineBanner } from '../../components/OfflineBanner';
import type { SessionUser } from '@nodescope/shared';

export default function AppLayout() {
  const router = useRouter();
  const { isAuthenticated, isLoading, setUser, setLoading } = useAuthStore();

  useEffect(() => {
    authClient.getSession().then((result) => {
      if (result.data?.user) {
        setUser(result.data.user as SessionUser);
        websocketService.connect();
        browserCollectorService.start();
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

    const unsubscribeMetrics = subscribeToMetricsUpdates();

    return () => {
      browserCollectorService.stop();
      unsubscribeMetrics();
      websocketService.disconnect();
    };
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

  return (
    <View className="flex-1">
      <OfflineBanner />
      <Stack screenOptions={{ headerShown: false }} />
    </View>
  );
}
