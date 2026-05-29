import { View, Text, ActivityIndicator, TouchableOpacity } from 'react-native';

type ListScreenStatusProps =
  | { state: 'loading' }
  | { state: 'error'; error: string; onRetry: () => void };

/**
 * Shared loading / error states for the full-screen list views (equipment,
 * circuits, clients), which each rendered a byte-identical centered spinner
 * and a red message + Retry button. Presentational only — each screen keeps
 * its own gating logic (when to render this) and supplies the error copy and
 * retry handler. The discriminated union makes `error`/`onRetry` mandatory in
 * the error state, preserving the four-state model's "error always retries".
 */
export function ListScreenStatus(props: ListScreenStatusProps) {
  if (props.state === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-gray-900">
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-gray-900 px-8">
      <Text className="text-red-500 dark:text-red-400 text-center mb-4">{props.error}</Text>
      <TouchableOpacity onPress={props.onRetry} className="bg-blue-600 px-6 py-2 rounded-lg">
        <Text className="text-white font-medium">Retry</Text>
      </TouchableOpacity>
    </View>
  );
}
