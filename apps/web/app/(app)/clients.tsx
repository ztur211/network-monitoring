import { useState, useEffect } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, ScrollView } from 'react-native';
import { api } from '../../lib/api.service';
import { useRealtimeStore } from '../../store/realtime.store';
import { Timestamp } from '../../components/Timestamp';
import { StaleDataOverlay } from '../../components/StaleDataOverlay';

interface ClientsData {
  currentDevice: {
    userAgent: string;
    platform: string | null;
    metrics: {
      bandwidthDown: number | null;
      bandwidthUp: number | null;
      latency: number | null;
      connectionQuality: string | null;
      timestamp: string;
    } | null;
  };
  agentStatus: {
    available: false;
    message: string;
  };
}

type ScreenState = 'loading' | 'loaded' | 'error';

export default function ClientsScreen() {
  const [screenState, setScreenState] = useState<ScreenState>('loading');
  const [data, setData] = useState<ClientsData | null>(null);
  const { metrics, isStale } = useRealtimeStore();
  const stale = isStale();

  const load = async () => {
    setScreenState('loading');
    try {
      const res = await api.get<{ success: true; data: ClientsData }>('/clients');
      setData(res.data.data);
      setScreenState('loaded');
    } catch {
      setScreenState('error');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (screenState === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-gray-900">
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (screenState === 'error') {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-gray-900 px-8">
        <Text className="text-red-500 dark:text-red-400 text-center mb-4">
          Failed to load client information.
        </Text>
        <TouchableOpacity
          onPress={() => void load()}
          className="bg-blue-600 px-6 py-2 rounded-lg"
        >
          <Text className="text-white font-medium">Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const device = data!.currentDevice;
  const liveMetrics = metrics ?? device.metrics;

  return (
    <ScrollView className="flex-1 bg-white dark:bg-gray-900">
      {/* Header */}
      <View className="px-4 pt-12 pb-3 border-b border-gray-200 dark:border-gray-700">
        <Text className="text-2xl font-bold text-gray-900 dark:text-white">Clients</Text>
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Devices on your network
        </Text>
      </View>

      {/* Agent coming soon panel */}
      <View className="mx-4 mt-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
        <Text className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">
          Full client discovery coming post-MVP
        </Text>
        <Text className="text-sm text-blue-700 dark:text-blue-400 leading-5">
          Automatic discovery of all connected clients requires the NodeScope desktop Agent
          (post-MVP Priority 1). When the Agent ships, this view will automatically populate with
          every device on your network — no manual entry needed.
        </Text>
      </View>

      {/* Current Device section */}
      <View className="px-4 mt-6">
        <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
          This Device
        </Text>

        <StaleDataOverlay isStale={stale}>
          <View className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
            <View className="flex-row items-center justify-between mb-3">
              <View>
                <Text className="text-base font-semibold text-gray-900 dark:text-white">
                  {device.platform ?? 'Unknown Platform'}
                </Text>
                <Text
                  className="text-xs text-gray-500 dark:text-gray-400 mt-0.5"
                  numberOfLines={2}
                >
                  {device.userAgent}
                </Text>
              </View>
              <View className="w-2.5 h-2.5 rounded-full bg-green-500 ml-3" />
            </View>

            {liveMetrics ? (
              <>
                <View className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-1">
                  <View className="flex-row flex-wrap gap-x-6 gap-y-2">
                    {liveMetrics.latency !== null && (
                      <MetricItem label="Latency" value={`${liveMetrics.latency} ms`} />
                    )}
                    {liveMetrics.bandwidthDown !== null && (
                      <MetricItem
                        label="Download"
                        value={formatBandwidth(liveMetrics.bandwidthDown)}
                      />
                    )}
                    {liveMetrics.bandwidthUp !== null && (
                      <MetricItem
                        label="Upload"
                        value={formatBandwidth(liveMetrics.bandwidthUp)}
                      />
                    )}
                    {liveMetrics.connectionQuality && (
                      <MetricItem
                        label="Connection"
                        value={liveMetrics.connectionQuality.toUpperCase()}
                      />
                    )}
                  </View>
                </View>
                <View className="mt-2">
                  <Timestamp isoTimestamp={liveMetrics.timestamp} />
                </View>
              </>
            ) : (
              <Text className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                No live metrics yet — data updates every 30 seconds.
              </Text>
            )}
          </View>
        </StaleDataOverlay>
      </View>

      {/* Data source info */}
      <View className="px-4 mt-4 mb-8">
        <Text className="text-xs text-gray-400 dark:text-gray-500 text-center">
          Metrics collected by browser collector · Updates every 30 seconds
        </Text>
      </View>
    </ScrollView>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-xs text-gray-500 dark:text-gray-400">{label}</Text>
      <Text className="text-sm font-semibold text-gray-900 dark:text-white">{value}</Text>
    </View>
  );
}

function formatBandwidth(mbps: number): string {
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(1)} Gbps`;
  return `${mbps.toFixed(1)} Mbps`;
}
