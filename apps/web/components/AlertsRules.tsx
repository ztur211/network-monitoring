/**
 * AlertsRules — presentational component for alert rules in org settings
 * (admin-gated; rendered only for OWNER/ADMIN — see settings.tsx).
 *
 * Covers:
 *  - List existing rules (name + a compact summary: trigger · scope kind ·
 *    severity · channel count)
 *  - Create a new rule:
 *      trigger pill (STATE_TRANSITION | METRIC_THRESHOLD) switches which
 *      trigger-conditional fields render:
 *        STATE_TRANSITION  → targetStates multi-pills (DOWN, WARNING)
 *        METRIC_THRESHOLD  → metric (fixed: latencyMs), op pill (gt|lt),
 *                            threshold, forSeconds
 *      scope kind pill (all|deviceIds|siteIds|networkIds) assembles
 *      `{ all: true }` or `{ deviceIds: [...] }` / etc.
 *      channelIds via a name toggle-pill multi-select (channels are loaded
 *      through the injected client so a rule can be wired to real channels)
 *  - Delete a rule
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
  Switch,
} from 'react-native';
import type {
  AlertRuleDto,
  CreateAlertRuleDto,
  AlertChannelDto,
  AlertTrigger,
  AlertSeverity,
} from '@nodescope/shared';

// ─── Client interface ─────────────────────────────────────────────────────────

export interface AlertsRulesClient {
  listRules: () => Promise<AlertRuleDto[]>;
  createRule: (dto: CreateAlertRuleDto) => Promise<AlertRuleDto>;
  deleteRule: (id: string) => Promise<void>;
  listChannels: () => Promise<AlertChannelDto[]>;
}

interface Props {
  client: AlertsRulesClient;
}

const TRIGGERS: AlertTrigger[] = ['STATE_TRANSITION', 'METRIC_THRESHOLD'];
const SEVERITIES: AlertSeverity[] = ['INFO', 'WARNING', 'CRITICAL'];
const TARGET_STATES = ['DOWN', 'WARNING'] as const;
const SCOPE_KINDS = ['all', 'deviceIds', 'siteIds', 'networkIds'] as const;
type ScopeKind = (typeof SCOPE_KINDS)[number];
const OPS = ['gt', 'lt'] as const;

/** Parse a comma-separated id input into a trimmed, non-empty-only id list. */
const parseIds = (s: string): string[] => s.split(',').map((t) => t.trim()).filter(Boolean);

/** Derive a display label for a rule's scope kind from its stored `scope` blob. */
function scopeKindOf(scope: Record<string, unknown>): string {
  if (scope?.all === true) return 'all';
  if (Array.isArray(scope?.deviceIds)) return 'deviceIds';
  if (Array.isArray(scope?.siteIds)) return 'siteIds';
  if (Array.isArray(scope?.networkIds)) return 'networkIds';
  return 'custom';
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AlertsRules({ client }: Props) {
  const [rules, setRules] = useState<AlertRuleDto[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Channels — needed for the channel multi-select
  const [channels, setChannels] = useState<AlertChannelDto[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelsError, setChannelsError] = useState(false);

  // Create form
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<AlertTrigger>('STATE_TRANSITION');
  const [severity, setSeverity] = useState<AlertSeverity>('WARNING');
  const [notifyOnRecovery, setNotifyOnRecovery] = useState(true);
  const [cooldownSeconds, setCooldownSeconds] = useState('60');

  const [scopeKind, setScopeKind] = useState<ScopeKind>('all');
  const [scopeIdsInput, setScopeIdsInput] = useState('');

  const [targetStates, setTargetStates] = useState<string[]>([]);
  const [op, setOp] = useState<'gt' | 'lt'>('gt');
  const [threshold, setThreshold] = useState('');
  const [forSeconds, setForSeconds] = useState('60');

  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ── Load ──

  const loadRules = async () => {
    setRulesLoading(true);
    setRulesError(false);
    try {
      const data = await client.listRules();
      setRules(data);
    } catch {
      setRulesError(true);
    } finally {
      setRulesLoading(false);
    }
  };

  const loadChannels = async () => {
    setChannelsLoading(true);
    setChannelsError(false);
    try {
      const data = await client.listChannels();
      setChannels(data);
    } catch {
      setChannelsError(true);
    } finally {
      setChannelsLoading(false);
    }
  };

  useEffect(() => {
    void loadRules();
    void loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Helpers ──

  const toggleTargetState = (state: string) => {
    setTargetStates((prev) =>
      prev.includes(state) ? prev.filter((s) => s !== state) : [...prev, state],
    );
  };

  const toggleChannel = (id: string) => {
    setSelectedChannelIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  const resetForm = () => {
    setName('');
    setTrigger('STATE_TRANSITION');
    setSeverity('WARNING');
    setNotifyOnRecovery(true);
    setCooldownSeconds('60');
    setScopeKind('all');
    setScopeIdsInput('');
    setTargetStates([]);
    setOp('gt');
    setThreshold('');
    setForSeconds('60');
    setSelectedChannelIds([]);
  };

  const canSubmit = (() => {
    if (!name.trim()) return false;
    if (selectedChannelIds.length === 0) return false;
    if (scopeKind !== 'all' && parseIds(scopeIdsInput).length === 0) return false;
    if (trigger === 'STATE_TRANSITION' && targetStates.length === 0) return false;
    // Same bug class as threshold/forSeconds below: `parseInt('-5', 10) || 0`
    // is `-5` (truthy, so the `|| 0` fallback never kicks in) — validate the
    // parsed value is a real non-negative integer before enabling submit,
    // rather than sending a value the backend's `@Min(0)` rejects as an
    // opaque 400.
    const cooldownNum = Number(cooldownSeconds);
    if (!cooldownSeconds.trim() || !Number.isInteger(cooldownNum) || cooldownNum < 0) {
      return false;
    }
    if (trigger === 'METRIC_THRESHOLD') {
      const thresholdNum = Number(threshold);
      const forSecondsNum = Number(forSeconds);
      // `Number('')` is 0 (not NaN), so keep the non-empty check alongside the
      // finite/integer checks — otherwise a blank field would silently submit as 0.
      if (!threshold.trim() || !Number.isFinite(thresholdNum)) return false;
      if (!forSeconds.trim() || !Number.isInteger(forSecondsNum) || forSecondsNum <= 0) {
        return false;
      }
    }
    return true;
  })();

  // ── Handlers ──

  const handleCreate = async () => {
    if (!canSubmit) return;
    setCreating(true);
    setCreateError(null);
    try {
      const scope: Record<string, unknown> =
        scopeKind === 'all' ? { all: true } : { [scopeKind]: parseIds(scopeIdsInput) };

      const dto: CreateAlertRuleDto = {
        name: name.trim(),
        trigger,
        scope,
        severity,
        channelIds: selectedChannelIds,
        // canSubmit guarantees this parses to a non-negative integer before we
        // ever get here — no `|| 0` fallback, which previously masked negative
        // values (`parseInt('-5', 10) || 0` is `-5`, not `0`).
        cooldownSeconds: Number(cooldownSeconds),
        notifyOnRecovery,
        ...(trigger === 'STATE_TRANSITION'
          ? { targetStates }
          : {
              metric: 'latencyMs',
              op,
              // canSubmit guarantees these parse to finite/positive-integer
              // numbers before we ever get here.
              threshold: Number(threshold),
              forSeconds: parseInt(forSeconds, 10),
            }),
      };

      const created = await client.createRule(dto);
      setRules((prev) => [...prev, created]);
      resetForm();
    } catch {
      setCreateError('Failed to create rule. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await client.deleteRule(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch {
      if (typeof window !== 'undefined') {
        window.alert('Failed to delete rule.');
      }
    } finally {
      setDeletingId(null);
    }
  };

  // ── Render ──

  return (
    <View className="px-4 mt-6 mb-2">
      <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
        Alert Rules
      </Text>

      {/* Existing rules list */}
      <View className="bg-gray-50 dark:bg-gray-800 rounded-xl overflow-hidden mb-4">
        {rulesLoading ? (
          <View className="py-6 items-center">
            <ActivityIndicator size="small" color="#6b7280" />
          </View>
        ) : rulesError ? (
          <View className="px-4 py-4 flex-row items-center justify-between">
            <Text className="text-sm text-red-500 dark:text-red-400 flex-1">
              Failed to load rules.
            </Text>
            <TouchableOpacity
              onPress={() => void loadRules()}
              className="bg-blue-600 px-3 py-1.5 rounded-lg ml-3"
            >
              <Text className="text-white text-sm font-medium">Retry</Text>
            </TouchableOpacity>
          </View>
        ) : rules.length === 0 ? (
          <View className="px-4 py-4">
            <Text className="text-sm text-gray-500 dark:text-gray-400">
              No alert rules configured.
            </Text>
          </View>
        ) : (
          <FlatList
            data={rules}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            renderItem={({ item: rule, index }) => (
              <View
                className={`px-4 py-3.5 flex-row items-center justify-between ${
                  index < rules.length - 1 ? 'border-b border-gray-200 dark:border-gray-700' : ''
                }`}
              >
                <View className="flex-1 mr-3">
                  <Text className="text-base font-medium text-gray-900 dark:text-white">
                    {rule.name}
                  </Text>
                  <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {rule.trigger} · {scopeKindOf(rule.scope)} · {rule.severity} ·{' '}
                    {rule.channelIds.length} channel{rule.channelIds.length === 1 ? '' : 's'}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => void handleDelete(rule.id)}
                  disabled={deletingId === rule.id}
                  className={`rounded-lg px-3 py-1.5 ${
                    deletingId === rule.id
                      ? 'bg-red-300 dark:bg-red-900'
                      : 'bg-red-100 dark:bg-red-900/40'
                  }`}
                >
                  {deletingId === rule.id ? (
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

      {/* Create rule form */}
      <View className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-6">
        <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Add Rule
        </Text>

        <View className="mb-3">
          <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. device-down"
            placeholderTextColor="#9ca3af"
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
          />
        </View>

        {/* Trigger picker */}
        <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">Trigger</Text>
        <View className="mb-3 flex-row">
          {TRIGGERS.map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setTrigger(t)}
              className={`mr-2 px-4 py-2 rounded-lg border ${
                trigger === t
                  ? 'bg-blue-600 border-blue-600'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
              }`}
            >
              <Text
                className={`text-sm font-medium ${
                  trigger === t ? 'text-white' : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Trigger-conditional fields */}
        {trigger === 'STATE_TRANSITION' ? (
          <View className="mb-3">
            <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              Target States
            </Text>
            <View className="flex-row">
              {TARGET_STATES.map((state) => (
                <TouchableOpacity
                  key={state}
                  onPress={() => toggleTargetState(state)}
                  className={`mr-2 px-3 py-1.5 rounded-full border ${
                    targetStates.includes(state)
                      ? 'bg-blue-600 border-blue-600'
                      : 'bg-transparent border-gray-300 dark:border-gray-600'
                  }`}
                >
                  <Text
                    className={`text-sm ${
                      targetStates.includes(state)
                        ? 'text-white'
                        : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {state}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <>
            <View className="mb-3">
              <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">Metric</Text>
              <Text className="text-sm text-gray-700 dark:text-gray-300 py-1">latencyMs</Text>
            </View>
            <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">Operator</Text>
            <View className="mb-3 flex-row">
              {OPS.map((o) => (
                <TouchableOpacity
                  key={o}
                  onPress={() => setOp(o)}
                  className={`mr-2 px-4 py-2 rounded-lg border ${
                    op === o
                      ? 'bg-blue-600 border-blue-600'
                      : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
                  }`}
                >
                  <Text
                    className={`text-sm font-medium ${
                      op === o ? 'text-white' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {o}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View className="mb-3">
              <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                Threshold (ms)
              </Text>
              <TextInput
                value={threshold}
                onChangeText={setThreshold}
                placeholder="500"
                placeholderTextColor="#9ca3af"
                keyboardType="numeric"
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
              />
            </View>
            <View className="mb-3">
              <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                For Seconds (sustained duration)
              </Text>
              <TextInput
                value={forSeconds}
                onChangeText={setForSeconds}
                placeholder="60"
                placeholderTextColor="#9ca3af"
                keyboardType="numeric"
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
              />
            </View>
          </>
        )}

        {/* Severity picker */}
        <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">Severity</Text>
        <View className="mb-3 flex-row">
          {SEVERITIES.map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => setSeverity(s)}
              className={`mr-2 px-4 py-2 rounded-lg border ${
                severity === s
                  ? 'bg-blue-600 border-blue-600'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
              }`}
            >
              <Text
                className={`text-sm font-medium ${
                  severity === s ? 'text-white' : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                {s}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Scope picker */}
        <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">Scope</Text>
        <View className="mb-3 flex-row flex-wrap">
          {SCOPE_KINDS.map((k) => (
            <TouchableOpacity
              key={k}
              onPress={() => setScopeKind(k)}
              className={`mr-2 mb-2 px-4 py-2 rounded-lg border ${
                scopeKind === k
                  ? 'bg-blue-600 border-blue-600'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
              }`}
            >
              <Text
                className={`text-sm font-medium ${
                  scopeKind === k ? 'text-white' : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                {k}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {scopeKind !== 'all' && (
          <View className="mb-3">
            <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              {scopeKind} (comma-separated IDs)
            </Text>
            <TextInput
              value={scopeIdsInput}
              onChangeText={setScopeIdsInput}
              placeholder="uuid-1, uuid-2"
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
            />
          </View>
        )}

        {/* Channels multi-select */}
        <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">Channels</Text>
        {channelsLoading ? (
          <View className="py-3 items-center">
            <ActivityIndicator size="small" color="#6b7280" />
          </View>
        ) : channelsError ? (
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-sm text-red-500 dark:text-red-400 flex-1">
              Failed to load channels.
            </Text>
            <TouchableOpacity
              onPress={() => void loadChannels()}
              className="bg-blue-600 px-3 py-1.5 rounded-lg ml-3"
            >
              <Text className="text-white text-sm font-medium">Retry</Text>
            </TouchableOpacity>
          </View>
        ) : channels.length === 0 ? (
          <Text className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            No channels configured yet — add one above first.
          </Text>
        ) : (
          <View className="mb-3 flex-row flex-wrap">
            {channels.map((c) => (
              <TouchableOpacity
                key={c.id}
                onPress={() => toggleChannel(c.id)}
                className={`mr-2 mb-2 px-3 py-1.5 rounded-full border ${
                  selectedChannelIds.includes(c.id)
                    ? 'bg-blue-600 border-blue-600'
                    : 'bg-transparent border-gray-300 dark:border-gray-600'
                }`}
              >
                <Text
                  className={`text-sm ${
                    selectedChannelIds.includes(c.id)
                      ? 'text-white'
                      : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {c.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Notify on recovery + cooldown */}
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-sm text-gray-700 dark:text-gray-300">Notify on Recovery</Text>
          <Switch
            value={notifyOnRecovery}
            onValueChange={setNotifyOnRecovery}
            trackColor={{ false: '#d1d5db', true: '#2563eb' }}
            thumbColor="white"
          />
        </View>

        <View className="mb-4">
          <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            Cooldown (seconds)
          </Text>
          <TextInput
            value={cooldownSeconds}
            onChangeText={setCooldownSeconds}
            placeholder="60"
            placeholderTextColor="#9ca3af"
            keyboardType="numeric"
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
          />
        </View>

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
            <Text className="text-white font-medium">Add Rule</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
