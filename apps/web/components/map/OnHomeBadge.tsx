import { Platform, Text, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { useNetworkStore } from '../../store/network.store';

export function OnHomeBadge() {
  const network = useNetworkStore((s) => s.network);
  const onHome = useNetworkStore((s) => s.onHome);
  const savingHomeIp = useNetworkStore((s) => s.savingHomeIp);
  const setHomeIpError = useNetworkStore((s) => s.setHomeIpError);
  const setHomeIp = useNetworkStore((s) => s.setHomeIp);

  // Hidden until the user has at least one network. Pre-onboarding the badge
  // would always be grey, which reads as a complaint about state the user
  // hasn't been asked to fix yet.
  if (!network) return null;

  const interactive = !onHome && !savingHomeIp;

  const handlePress = () => {
    if (!interactive) return;
    // Browser-native confirm — RN-Web's Alert.alert is a console-warn stub,
    // matches the pattern used for delete confirms in equipment.tsx.
    const confirmed =
      Platform.OS === 'web'
        ? typeof window !== 'undefined' && window.confirm('Save your current IP as your home network IP?')
        : true;
    if (!confirmed) return;
    void setHomeIp();
  };

  const label = savingHomeIp
    ? 'Saving home IP…'
    : onHome
      ? 'On home network'
      : 'Tap to set as home';
  const dotClass = onHome ? 'bg-emerald-500' : 'bg-gray-400';
  const containerClass = onHome
    ? 'bg-emerald-50 border-emerald-200'
    : 'bg-gray-100 border-gray-200 dark:bg-gray-800 dark:border-gray-700';
  const textClass = onHome
    ? 'text-emerald-800'
    : 'text-gray-600 dark:text-gray-300';

  const inner = (
    <View
      className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1 ${containerClass}`}
    >
      {savingHomeIp ? (
        <ActivityIndicator size="small" color="#6b7280" />
      ) : (
        <View className={`w-2 h-2 rounded-full ${dotClass}`} />
      )}
      <Text className={`text-xs font-medium ${textClass}`}>{label}</Text>
    </View>
  );

  return (
    <View>
      {interactive ? (
        <TouchableOpacity onPress={handlePress} accessibilityRole="button">
          {inner}
        </TouchableOpacity>
      ) : (
        inner
      )}
      {setHomeIpError && (
        <Text className="text-[10px] text-red-500 mt-0.5 ml-1">{setHomeIpError}</Text>
      )}
    </View>
  );
}
