import { useEffect } from 'react';
import { View, Text, FlatList } from 'react-native';
import type { AlertEventDto, AlertSeverity, AlertEventKind } from '@nodescope/shared';
import { useAlertsStore } from '../../store/alerts.store';
import { useAccessStore, isOrgAdmin } from '../../store/access.store';
import { listAlertEvents } from '../../lib/api.service';

const SEVERITY_DOT: Record<AlertSeverity, string> = {
  INFO: 'bg-blue-500',
  WARNING: 'bg-amber-500',
  CRITICAL: 'bg-red-500',
};

const SEVERITY_TEXT: Record<AlertSeverity, string> = {
  INFO: 'text-blue-600 dark:text-blue-400',
  WARNING: 'text-amber-600 dark:text-amber-400',
  CRITICAL: 'text-red-600 dark:text-red-400',
};

const KIND_BADGE: Record<AlertEventKind, { bg: string; text: string }> = {
  FIRING: { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300' },
  RESOLVED: { bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-700 dark:text-green-300' },
};

export default function AlertsScreen() {
  const events = useAlertsStore((s) => s.events);
  const role = useAccessStore((s) => s.role);

  useEffect(() => {
    // Non-admins hit a 403 here (endpoint is OWNER/ADMIN-gated) — swallowed
    // the same as any other load failure, since the gate below already
    // covers the render for that case.
    listAlertEvents()
      .then((e) => useAlertsStore.getState().setInitial(e))
      .catch(() => undefined);
  }, []);

  if (!isOrgAdmin(role)) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-gray-900 px-8">
        <Text className="text-gray-400 dark:text-gray-500 text-center text-lg font-medium mb-2">
          Admin access required
        </Text>
        <Text className="text-gray-400 dark:text-gray-500 text-center text-sm">
          Alerts are only visible to organization owners and admins.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-gray-900">
      {/* Header */}
      <View className="px-4 pt-12 pb-3 border-b border-gray-200 dark:border-gray-700">
        <Text className="text-2xl font-bold text-gray-900 dark:text-white">Alerts</Text>
        {events.length > 0 && (
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {events.length} event{events.length === 1 ? '' : 's'}
          </Text>
        )}
      </View>

      {/* List */}
      {events.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-gray-400 dark:text-gray-500 text-center text-lg font-medium mb-2">
            No alerts yet
          </Text>
          <Text className="text-gray-400 dark:text-gray-500 text-center text-sm">
            Firing and resolved alerts will appear here in real time.
          </Text>
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <AlertEventCard item={item} />}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      )}
    </View>
  );
}

function AlertEventCard({ item }: { item: AlertEventDto }) {
  const badge = KIND_BADGE[item.kind];
  return (
    <View className="mx-4 mt-3 bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
      <View className="flex-row items-center justify-between mb-1">
        <View className="flex-row items-center flex-1 mr-3">
          <View className={`w-2 h-2 rounded-full mr-2 ${SEVERITY_DOT[item.severity]}`} />
          <Text className={`text-xs font-semibold uppercase tracking-wider ${SEVERITY_TEXT[item.severity]}`}>
            {item.severity}
          </Text>
        </View>
        <View className={`px-2 py-0.5 rounded-full ${badge.bg}`}>
          <Text className={`text-xs font-medium ${badge.text}`}>{item.kind}</Text>
        </View>
      </View>

      <Text className="text-sm font-medium text-gray-900 dark:text-white mt-1">
        Rule {item.ruleId}
      </Text>
      <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
        {item.deviceId ? `Device ${item.deviceId}` : 'No device'}
      </Text>

      <Text className="text-xs text-gray-400 dark:text-gray-500 mt-2">
        {new Date(item.createdAt).toLocaleString()}
      </Text>
    </View>
  );
}
