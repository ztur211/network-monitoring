import { View, Text } from 'react-native';
import { useNetworkStore } from '../../store/network.store';

// Display-only for PR 1. The plan's "tap to save this IP as my home IP" flow
// requires a server-side endpoint that reads req.ip (the browser cannot detect
// its own public IP); that lands with the IP-rotation banner in PR 2.
export function OnHomeBadge() {
  const network = useNetworkStore((s) => s.network);
  const onHome = useNetworkStore((s) => s.onHome);

  // Hidden until the user has at least one network. Pre-onboarding the badge
  // would always be grey, which reads as a complaint about state the user
  // hasn't been asked to fix yet.
  if (!network) return null;

  const label = onHome ? 'On home network' : 'Away from home';
  const dotClass = onHome ? 'bg-emerald-500' : 'bg-gray-400';
  const containerClass = onHome
    ? 'bg-emerald-50 border-emerald-200'
    : 'bg-gray-100 border-gray-200 dark:bg-gray-800 dark:border-gray-700';
  const textClass = onHome
    ? 'text-emerald-800'
    : 'text-gray-600 dark:text-gray-300';

  return (
    <View
      className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1 ${containerClass}`}
    >
      <View className={`w-2 h-2 rounded-full ${dotClass}`} />
      <Text className={`text-xs font-medium ${textClass}`}>{label}</Text>
    </View>
  );
}
