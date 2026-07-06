/**
 * AlertsChannels — presentational component for alert notification channels
 * in org settings (admin-gated; rendered only for OWNER/ADMIN — see settings.tsx).
 *
 * Covers:
 *  - List existing channels (type + name + enabled; secrets are NEVER shown —
 *    the API's redacted AlertChannelDto never includes them either)
 *  - Create a new channel, form fields switching on a type pill:
 *      WEBHOOK → name, url, secret? (bearer token, write-only)
 *      EMAIL   → name, host, port, fromAddr, toAddrs (comma → string[]), username?, password? (write-only)
 *      INAPP   → name, siteId?
 *  - Delete a channel
 *  - Test a channel (fires a test notification through it)
 *
 * All server interaction goes through the injected `client` prop so this
 * component is fully presentational and testable without a real API.
 *
 * NOTE: No component render test exists for this file — the repo has no
 * RN-component test infrastructure (no @testing-library/react, no
 * react-test-renderer). Client methods are covered by api.service.alerts.spec.ts.
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import type {
  AlertChannelDto,
  CreateAlertChannelDto,
  AlertChannelType,
} from '@nodescope/shared';

// ─── Client interface ─────────────────────────────────────────────────────────

export interface AlertsChannelsClient {
  listChannels: () => Promise<AlertChannelDto[]>;
  createChannel: (dto: CreateAlertChannelDto) => Promise<AlertChannelDto>;
  deleteChannel: (id: string) => Promise<void>;
  testChannel: (id: string) => Promise<void>;
}

interface Props {
  client: AlertsChannelsClient;
}

const CHANNEL_TYPES: AlertChannelType[] = ['WEBHOOK', 'EMAIL', 'INAPP'];

// ─── Component ───────────────────────────────────────────────────────────────

export function AlertsChannels({ client }: Props) {
  const [channels, setChannels] = useState<AlertChannelDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  // Create form — common
  const [newType, setNewType] = useState<AlertChannelType>('WEBHOOK');
  const [newName, setNewName] = useState('');

  // WEBHOOK fields
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');

  // EMAIL fields
  const [emailHost, setEmailHost] = useState('');
  const [emailPort, setEmailPort] = useState('');
  const [emailFromAddr, setEmailFromAddr] = useState('');
  const [emailToAddrs, setEmailToAddrs] = useState('');
  const [emailUsername, setEmailUsername] = useState('');
  const [emailPassword, setEmailPassword] = useState('');

  // INAPP fields
  const [inappSiteId, setInappSiteId] = useState('');

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ── Load ──

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await client.listChannels();
      setChannels(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Helpers ──

  const resetForm = () => {
    setNewName('');
    setWebhookUrl('');
    setWebhookSecret('');
    setEmailHost('');
    setEmailPort('');
    setEmailFromAddr('');
    setEmailToAddrs('');
    setEmailUsername('');
    setEmailPassword('');
    setInappSiteId('');
  };

  const canSubmit = (() => {
    if (!newName.trim()) return false;
    if (newType === 'WEBHOOK') return !!webhookUrl.trim();
    if (newType === 'EMAIL') {
      return !!emailHost.trim() && !!emailFromAddr.trim() && !!emailToAddrs.trim();
    }
    return true; // INAPP — siteId optional
  })();

  // ── Handlers ──

  const handleCreate = async () => {
    if (!canSubmit) return;
    setCreating(true);
    setCreateError(null);
    try {
      let dto: CreateAlertChannelDto;
      if (newType === 'WEBHOOK') {
        dto = {
          type: 'WEBHOOK',
          name: newName.trim(),
          config: { url: webhookUrl.trim() },
          ...(webhookSecret.trim() ? { secret: webhookSecret.trim() } : {}),
        };
      } else if (newType === 'EMAIL') {
        const toAddrs = emailToAddrs
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean);
        dto = {
          type: 'EMAIL',
          name: newName.trim(),
          config: {
            host: emailHost.trim(),
            port: emailPort.trim() ? parseInt(emailPort, 10) : undefined,
            fromAddr: emailFromAddr.trim(),
            toAddrs,
            ...(emailUsername.trim() ? { username: emailUsername.trim() } : {}),
          },
          ...(emailPassword.trim() ? { secret: emailPassword.trim() } : {}),
        };
      } else {
        dto = {
          type: 'INAPP',
          name: newName.trim(),
          config: inappSiteId.trim() ? { siteId: inappSiteId.trim() } : {},
        };
      }
      const created = await client.createChannel(dto);
      setChannels((prev) => [...prev, created]);
      resetForm();
      setNewType('WEBHOOK');
    } catch {
      setCreateError('Failed to create channel. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await client.deleteChannel(id);
      setChannels((prev) => prev.filter((c) => c.id !== id));
    } catch {
      if (typeof window !== 'undefined') {
        window.alert('Failed to delete channel. It may be in use by an alert rule.');
      }
    } finally {
      setDeletingId(null);
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      await client.testChannel(id);
      if (typeof window !== 'undefined') {
        window.alert('Test notification sent.');
      }
    } catch {
      if (typeof window !== 'undefined') {
        window.alert('Test notification failed. Check the channel configuration.');
      }
    } finally {
      setTestingId(null);
    }
  };

  // ── Render ──

  return (
    <View className="px-4 mt-6 mb-2">
      <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
        Alert Channels
      </Text>

      {/* Existing channels list */}
      <View className="bg-gray-50 dark:bg-gray-800 rounded-xl overflow-hidden mb-4">
        {loading ? (
          <View className="py-6 items-center">
            <ActivityIndicator size="small" color="#6b7280" />
          </View>
        ) : error ? (
          <View className="px-4 py-4 flex-row items-center justify-between">
            <Text className="text-sm text-red-500 dark:text-red-400 flex-1">
              Failed to load channels.
            </Text>
            <TouchableOpacity
              onPress={() => void load()}
              className="bg-blue-600 px-3 py-1.5 rounded-lg ml-3"
            >
              <Text className="text-white text-sm font-medium">Retry</Text>
            </TouchableOpacity>
          </View>
        ) : channels.length === 0 ? (
          <View className="px-4 py-4">
            <Text className="text-sm text-gray-500 dark:text-gray-400">
              No alert channels configured.
            </Text>
          </View>
        ) : (
          <FlatList
            data={channels}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            renderItem={({ item: channel, index }) => (
              <View
                className={`px-4 py-3.5 flex-row items-center justify-between ${
                  index < channels.length - 1
                    ? 'border-b border-gray-200 dark:border-gray-700'
                    : ''
                }`}
              >
                <View className="flex-1 mr-3">
                  <Text className="text-base font-medium text-gray-900 dark:text-white">
                    {channel.name}
                  </Text>
                  <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {channel.type}
                    {channel.enabled ? '' : ' · disabled'}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => void handleTest(channel.id)}
                  disabled={testingId === channel.id}
                  className={`rounded-lg px-3 py-1.5 mr-2 ${
                    testingId === channel.id
                      ? 'bg-blue-300 dark:bg-blue-900'
                      : 'bg-blue-100 dark:bg-blue-900/40'
                  }`}
                >
                  {testingId === channel.id ? (
                    <ActivityIndicator size="small" color="#2563eb" />
                  ) : (
                    <Text className="text-blue-700 dark:text-blue-300 text-sm font-medium">
                      Test
                    </Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => void handleDelete(channel.id)}
                  disabled={deletingId === channel.id}
                  className={`rounded-lg px-3 py-1.5 ${
                    deletingId === channel.id
                      ? 'bg-red-300 dark:bg-red-900'
                      : 'bg-red-100 dark:bg-red-900/40'
                  }`}
                >
                  {deletingId === channel.id ? (
                    <ActivityIndicator size="small" color="#ef4444" />
                  ) : (
                    <Text className="text-red-700 dark:text-red-300 text-sm font-medium">
                      Delete
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </View>

      {/* Create channel form */}
      <View className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-6">
        <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Add Channel
        </Text>

        {/* Type picker */}
        <View className="mb-3 flex-row">
          {CHANNEL_TYPES.map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setNewType(t)}
              className={`mr-2 px-4 py-2 rounded-lg border ${
                newType === t
                  ? 'bg-blue-600 border-blue-600'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
              }`}
            >
              <Text
                className={`text-sm font-medium ${
                  newType === t ? 'text-white' : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View className="mb-3">
          <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">Name</Text>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="e.g. ops-webhook"
            placeholderTextColor="#9ca3af"
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
          />
        </View>

        {newType === 'WEBHOOK' && (
          <>
            <View className="mb-3">
              <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">URL</Text>
              <TextInput
                value={webhookUrl}
                onChangeText={setWebhookUrl}
                placeholder="https://example.com/hooks/nodescope"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
              />
            </View>
            <View className="mb-3">
              <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                Bearer Token (write-only, optional)
              </Text>
              <TextInput
                value={webhookSecret}
                onChangeText={setWebhookSecret}
                placeholder="secret"
                placeholderTextColor="#9ca3af"
                secureTextEntry
                autoComplete="off"
                autoCorrect={false}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
              />
            </View>
          </>
        )}

        {newType === 'EMAIL' && (
          <>
            <View className="mb-3">
              <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">SMTP Host</Text>
              <TextInput
                value={emailHost}
                onChangeText={setEmailHost}
                placeholder="smtp.example.com"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
              />
            </View>
            <View className="mb-3">
              <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">SMTP Port</Text>
              <TextInput
                value={emailPort}
                onChangeText={setEmailPort}
                placeholder="587"
                placeholderTextColor="#9ca3af"
                keyboardType="numeric"
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
              />
            </View>
            <View className="mb-3">
              <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">From Address</Text>
              <TextInput
                value={emailFromAddr}
                onChangeText={setEmailFromAddr}
                placeholder="alerts@example.com"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
              />
            </View>
            <View className="mb-3">
              <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                To Addresses (comma-separated)
              </Text>
              <TextInput
                value={emailToAddrs}
                onChangeText={setEmailToAddrs}
                placeholder="ops@example.com, oncall@example.com"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
              />
            </View>
            <View className="mb-3">
              <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                Username (optional)
              </Text>
              <TextInput
                value={emailUsername}
                onChangeText={setEmailUsername}
                placeholder="smtp username"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
              />
            </View>
            <View className="mb-3">
              <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                Password (write-only, optional)
              </Text>
              <TextInput
                value={emailPassword}
                onChangeText={setEmailPassword}
                placeholder="smtp password"
                placeholderTextColor="#9ca3af"
                secureTextEntry
                autoComplete="off"
                autoCorrect={false}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
              />
            </View>
          </>
        )}

        {newType === 'INAPP' && (
          <View className="mb-3">
            <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              Site ID (optional — scopes realtime delivery to a site)
            </Text>
            <TextInput
              value={inappSiteId}
              onChangeText={setInappSiteId}
              placeholder="site uuid or leave blank"
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
            />
          </View>
        )}

        {createError && (
          <Text className="text-red-500 dark:text-red-400 text-sm mb-3">{createError}</Text>
        )}

        <TouchableOpacity
          onPress={() => void handleCreate()}
          disabled={creating || !canSubmit}
          className={`rounded-lg py-2.5 items-center ${
            creating || !canSubmit ? 'bg-blue-400' : 'bg-blue-600'
          }`}
        >
          {creating ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text className="text-white font-medium">Add Channel</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
