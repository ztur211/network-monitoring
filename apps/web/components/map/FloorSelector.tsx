import { View, Text, TouchableOpacity } from 'react-native';
import { useUiStore, FloorDisplayMode } from '../../store/ui.store';

interface FloorSelectorProps {
  floors: number[];
  floorLabels: Record<number, string | null>;
}

export function FloorSelector({ floors, floorLabels }: FloorSelectorProps) {
  const { selectedFloor, floorDisplayMode, setSelectedFloor, setFloorDisplayMode } = useUiStore();

  if (floors.length === 0) return null;

  return (
    <View className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
      {/* Display mode toggle */}
      <View className="flex-row border-b border-gray-200 dark:border-gray-700">
        {(['all', 'single', 'connection'] as FloorDisplayMode[]).map((mode) => (
          <TouchableOpacity
            key={mode}
            onPress={() => setFloorDisplayMode(mode)}
            className={`flex-1 py-1.5 items-center ${
              floorDisplayMode === mode ? 'bg-blue-50 dark:bg-blue-900' : ''
            }`}
          >
            <Text
              className={`text-xs font-medium ${
                floorDisplayMode === mode
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              {MODE_LABEL[mode]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Connection mode notice — honesty audit item #11 */}
      {floorDisplayMode === 'connection' && (
        <View className="bg-blue-50 dark:bg-blue-900/30 px-3 py-1.5 border-b border-blue-100 dark:border-blue-800">
          <Text className="text-xs text-blue-600 dark:text-blue-400">
            Connections are manually documented — not auto-discovered
          </Text>
        </View>
      )}

      {/* Floor list */}
      <View>
        <TouchableOpacity
          onPress={() => setSelectedFloor(null)}
          className={`px-4 py-2 border-b border-gray-100 dark:border-gray-700 ${
            selectedFloor === null ? 'bg-blue-50 dark:bg-blue-900' : ''
          }`}
        >
          <Text
            className={`text-sm font-medium ${
              selectedFloor === null
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-700 dark:text-gray-300'
            }`}
          >
            All floors
          </Text>
        </TouchableOpacity>

        {[...floors].sort((a, b) => b - a).map((floor) => (
          <TouchableOpacity
            key={floor}
            onPress={() => setSelectedFloor(floor)}
            className={`px-4 py-2 border-b border-gray-100 dark:border-gray-700 ${
              selectedFloor === floor ? 'bg-blue-50 dark:bg-blue-900' : ''
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                selectedFloor === floor
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-700 dark:text-gray-300'
              }`}
            >
              {floorLabels[floor] ?? formatFloorLabel(floor)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const MODE_LABEL: Record<FloorDisplayMode, string> = {
  all: 'All',
  single: 'One',
  connection: 'Manual',
};

function formatFloorLabel(floor: number): string {
  if (floor === 0) return 'Ground';
  if (floor > 0) return `Floor ${floor}`;
  return `B${Math.abs(floor)}`;
}
