import { View, Text } from 'react-native';
import { useUiStore } from '../store/ui.store';

export function OfflineBanner() {
  const connectionStatus = useUiStore((s) => s.connectionStatus);
  const lastContactAt = useUiStore((s) => s.lastContactAt);

  if (connectionStatus === 'connected') return null;

  const isReconnecting = connectionStatus === 'reconnecting';
  const lastSeen = lastContactAt
    ? new Date(lastContactAt).toLocaleTimeString()
    : null;

  return (
    <View
      className={`px-4 py-2 ${isReconnecting ? 'bg-yellow-500' : 'bg-red-600'}`}
    >
      <Text className="text-white text-sm font-medium text-center">
        {isReconnecting
          ? 'Reconnecting to server…'
          : lastSeen
            ? `Offline — last contact at ${lastSeen}`
            : 'Offline — unable to connect to server'}
      </Text>
    </View>
  );
}
