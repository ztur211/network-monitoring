import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { authClient } from '../../lib/auth-client';
import { useAuthStore } from '../../store/auth.store';
import { websocketService } from '../../lib/websocket.service';
import { browserCollectorService, subscribeToMetricsUpdates } from '../../lib/browser-collector.service';
import { OfflineBanner } from '../../components/OfflineBanner';
import { useDeviceStore } from '../../store/device.store';
import { WS_EVENTS, DeviceDto, FiberRunDto, DeviceConnectionDto } from '@nodescope/shared';
import type { SessionUser } from '@nodescope/shared';

export default function AppLayout() {
  const router = useRouter();
  const { isAuthenticated, isLoading, setUser, setLoading } = useAuthStore();
  const { upsertDevice, removeDevice, flushOfflineQueue } = useDeviceStore();

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
    const unsubscribeEntities = subscribeToEntityEvents({ upsertDevice, removeDevice });

    // Flush offline queue on reconnect
    const handleReconnect = () => void flushOfflineQueue();
    websocketService.on('reconnect', handleReconnect);

    return () => {
      browserCollectorService.stop();
      unsubscribeMetrics();
      unsubscribeEntities();
      websocketService.off('reconnect', handleReconnect);
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

function subscribeToEntityEvents(store: {
  upsertDevice: (d: DeviceDto) => void;
  removeDevice: (id: string) => void;
}): () => void {
  const handleDeviceUpdated = (data: { device: DeviceDto }) => {
    store.upsertDevice(data.device);
  };

  const handleDeviceDeleted = (data: { deviceId: string }) => {
    store.removeDevice(data.deviceId);
  };

  // FiberRun and Connection events: no dedicated store in MVP;
  // viewport reload on map moveend will pick up changes.
  const noop = (_: FiberRunDto | DeviceConnectionDto) => {};

  websocketService.on<{ device: DeviceDto }>(WS_EVENTS.DEVICE_UPDATED, handleDeviceUpdated);
  websocketService.on<{ deviceId: string }>(WS_EVENTS.DEVICE_DELETED, handleDeviceDeleted);
  websocketService.on(WS_EVENTS.FIBER_RUN_UPDATED, noop as never);
  websocketService.on(WS_EVENTS.FIBER_RUN_DELETED, noop as never);
  websocketService.on(WS_EVENTS.CONNECTION_UPDATED, noop as never);
  websocketService.on(WS_EVENTS.CONNECTION_DELETED, noop as never);

  return () => {
    websocketService.off(WS_EVENTS.DEVICE_UPDATED, handleDeviceUpdated as never);
    websocketService.off(WS_EVENTS.DEVICE_DELETED, handleDeviceDeleted as never);
    websocketService.off(WS_EVENTS.FIBER_RUN_UPDATED, noop as never);
    websocketService.off(WS_EVENTS.FIBER_RUN_DELETED, noop as never);
    websocketService.off(WS_EVENTS.CONNECTION_UPDATED, noop as never);
    websocketService.off(WS_EVENTS.CONNECTION_DELETED, noop as never);
  };
}
