import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { DeviceCategory, DEVICE_CATEGORY_CONFIG } from '@nodescope/shared';
import { formatDeviceCategory } from '../../lib/format-category';
import { useUiStore } from '../../store/ui.store';

const CATEGORY_GROUPS: { label: string; categories: DeviceCategory[] }[] = [
  {
    label: 'ISP Equipment',
    categories: ['RAD', 'ONT', 'DSLAM'],
  },
  {
    label: 'Core Infrastructure',
    categories: ['ROUTER', 'MODEM', 'FIBER_MEDIA_CONVERTER', 'FIREWALL'],
  },
  {
    label: 'Network Equipment',
    categories: ['SWITCH', 'ACCESS_POINT', 'WIFI_EXTENDER', 'WIRELESS_BRIDGE', 'SERVER_RACK', 'PATCH_PANEL', 'UPS'],
  },
  {
    label: 'End-User Devices',
    categories: ['COMPUTER', 'PHONE', 'TABLET', 'PRINTER', 'IOT_DEVICE'],
  },
  {
    label: 'Other',
    categories: ['CUSTOM'],
  },
];

interface MapControlsProps {
  currentZoom: number;
}

export function MapControls({ currentZoom }: MapControlsProps) {
  const [expanded, setExpanded] = useState(false);
  const { layerToggles, setLayerToggle, buildingsVisible, setBuildingsVisible } = useUiStore();

  const zoomLabel = getZoomLabel(currentZoom);

  return (
    <View className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden min-w-[160px]">
      {/* Zoom label + toggle */}
      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        className="flex-row items-center justify-between px-3 py-2"
      >
        <View>
          <Text className="text-xs text-gray-400 dark:text-gray-500 uppercase font-semibold">
            Showing
          </Text>
          <Text className="text-sm font-medium text-gray-800 dark:text-gray-200">
            {zoomLabel}
          </Text>
        </View>
        <Text className="text-gray-400 dark:text-gray-500 text-lg ml-2">
          {expanded ? '▲' : '▼'}
        </Text>
      </TouchableOpacity>

      {expanded && (
        <ScrollView
          className="border-t border-gray-200 dark:border-gray-700"
          style={{ maxHeight: 260 }}
        >
          {/* Base map layers — sourced from the tile style, not from devices */}
          <View className="px-3 py-2">
            <Text className="text-xs text-gray-400 dark:text-gray-500 uppercase font-semibold mb-1">
              Base Map
            </Text>
            <TouchableOpacity
              onPress={() => setBuildingsVisible(!buildingsVisible)}
              className="flex-row items-center py-1"
            >
              <View
                className={`w-4 h-4 rounded border mr-2 items-center justify-center ${
                  buildingsVisible
                    ? 'bg-blue-600 border-blue-600'
                    : 'bg-transparent border-gray-400 dark:border-gray-500'
                }`}
              >
                {buildingsVisible && <Text className="text-white text-xs">✓</Text>}
              </View>
              <Text
                className={`text-sm ${
                  currentZoom < 13
                    ? 'text-gray-400 dark:text-gray-600'
                    : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                Buildings
              </Text>
              {currentZoom < 13 && (
                <Text className="text-xs text-gray-400 dark:text-gray-600 ml-1">
                  z13+
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {CATEGORY_GROUPS.map((group) => (
            <View key={group.label} className="px-3 py-2">
              <Text className="text-xs text-gray-400 dark:text-gray-500 uppercase font-semibold mb-1">
                {group.label}
              </Text>
              {group.categories.map((category) => {
                const visible = layerToggles[category] !== false;
                const minZoom = DEVICE_CATEGORY_CONFIG[category]?.minZoom ?? 16;
                const faded = currentZoom < minZoom;
                return (
                  <TouchableOpacity
                    key={category}
                    onPress={() => setLayerToggle(category, !visible)}
                    className="flex-row items-center py-1"
                  >
                    <View
                      className={`w-4 h-4 rounded border mr-2 items-center justify-center ${
                        visible
                          ? 'bg-blue-600 border-blue-600'
                          : 'bg-transparent border-gray-400 dark:border-gray-500'
                      }`}
                    >
                      {visible && <Text className="text-white text-xs">✓</Text>}
                    </View>
                    <Text
                      className={`text-sm ${
                        faded
                          ? 'text-gray-400 dark:text-gray-600'
                          : 'text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {formatDeviceCategory(category)}
                    </Text>
                    {faded && (
                      <Text className="text-xs text-gray-400 dark:text-gray-600 ml-1">
                        z{minZoom}+
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function getZoomLabel(zoom: number): string {
  if (zoom >= 18) return 'All devices';
  if (zoom >= 16) return 'Network equipment';
  if (zoom >= 13) return 'Core infrastructure';
  if (zoom >= 10) return 'ISP equipment';
  return 'City view';
}
