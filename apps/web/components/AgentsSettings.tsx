import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import type { AgentDto } from '@nodescope/shared';
import { resolveApiBaseUrl } from '../lib/api-base';

export interface AgentsClient {
  listAgents(): Promise<AgentDto[]>;
  generateAgentCode(): Promise<{ code: string }>;
  revokeAgent(id: string): Promise<void>;
}

interface Props {
  client: AgentsClient;
}

export function AgentsSettings({ client }: Props) {
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [enrollCode, setEnrollCode] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await client.listAgents();
      setAgents(data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateError(null);
    setEnrollCode(null);
    try {
      const { code } = await client.generateAgentCode();
      setEnrollCode(code);
    } catch {
      setGenerateError('Failed to generate enrollment code. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    try {
      await client.revokeAgent(id);
      setAgents((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: 'REVOKED' as const } : a)),
      );
    } catch {
      if (typeof window !== 'undefined') {
        window.alert('Failed to revoke agent. Please try again.');
      }
    } finally {
      setRevokingId(null);
    }
  };

  const statusColor = (status: AgentDto['status']) => {
    if (status === 'APPROVED') return 'text-green-700 dark:text-green-300';
    if (status === 'REVOKED') return 'text-red-500 dark:text-red-400';
    return 'text-yellow-600 dark:text-yellow-400';
  };

  return (
    <View className="px-4 mt-6 mb-8">
      {/* Section heading */}
      <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
        Agents
      </Text>

      {/* Enrollment code card */}
      <View className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-4">
        <Text className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          Generate a one-time code to enroll a new agent, then run the command below on the target
          host.
        </Text>

        <TouchableOpacity
          onPress={() => void handleGenerate()}
          disabled={generating}
          className={`rounded-lg py-2.5 items-center ${generating ? 'bg-blue-400' : 'bg-blue-600'}`}
        >
          {generating ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text className="text-white font-medium">Generate Enrollment Code</Text>
          )}
        </TouchableOpacity>

        {generateError && (
          <Text className="text-red-500 dark:text-red-400 text-sm mt-2">{generateError}</Text>
        )}

        {enrollCode && (
          <View className="mt-3 bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-3">
            <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              Run on the agent host (installs, verifies, and enrolls):
            </Text>
            <Text
              selectable
              className="text-sm font-mono text-gray-900 dark:text-white"
            >
              {`curl -fsSL ${resolveApiBaseUrl()}/agent/install.sh | sudo bash -s -- --server ${resolveApiBaseUrl()} --code ${enrollCode}`}
            </Text>
            <Text className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Already installed? Just enroll:{' '}
              <Text selectable className="font-mono">
                {`nodescope-agent enroll --code ${enrollCode}`}
              </Text>
            </Text>
          </View>
        )}
      </View>

      {/* Agent list */}
      <View className="bg-gray-50 dark:bg-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <View className="py-6 items-center">
            <ActivityIndicator size="small" color="#6b7280" />
          </View>
        ) : loadError ? (
          <View className="px-4 py-4 flex-row items-center justify-between">
            <Text className="text-sm text-red-500 dark:text-red-400 flex-1">
              Failed to load agents.
            </Text>
            <TouchableOpacity
              onPress={() => void load()}
              className="bg-blue-600 px-3 py-1.5 rounded-lg ml-3"
            >
              <Text className="text-white text-sm font-medium">Retry</Text>
            </TouchableOpacity>
          </View>
        ) : agents.length === 0 ? (
          <View className="px-4 py-4">
            <Text className="text-sm text-gray-500 dark:text-gray-400">
              No agents enrolled yet.
            </Text>
          </View>
        ) : (
          <FlatList
            data={agents}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            renderItem={({ item: agent, index }) => (
              <View
                className={`px-4 py-3.5 ${
                  index < agents.length - 1 ? 'border-b border-gray-200 dark:border-gray-700' : ''
                }`}
              >
                <View className="flex-row items-start justify-between">
                  <View className="flex-1 mr-3">
                    <Text className="text-base font-medium text-gray-900 dark:text-white">
                      {agent.name}
                    </Text>
                    <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {agent.platform ?? 'unknown platform'}
                      {agent.version ? ` · v${agent.version}` : ''}
                    </Text>
                    <View className="flex-row items-center mt-1">
                      <Text className={`text-xs font-medium ${statusColor(agent.status)}`}>
                        {agent.status}
                      </Text>
                      {agent.lastSeenAt && (
                        <Text className="text-xs text-gray-400 dark:text-gray-500 ml-2">
                          · Last seen: {new Date(agent.lastSeenAt).toLocaleString()}
                        </Text>
                      )}
                    </View>
                  </View>

                  {agent.status !== 'REVOKED' && (
                    <TouchableOpacity
                      onPress={() => void handleRevoke(agent.id)}
                      disabled={revokingId === agent.id}
                      className={`rounded-lg px-3 py-1.5 ${
                        revokingId === agent.id
                          ? 'bg-red-300 dark:bg-red-900'
                          : 'bg-red-100 dark:bg-red-900/40'
                      }`}
                    >
                      {revokingId === agent.id ? (
                        <ActivityIndicator size="small" color="#ef4444" />
                      ) : (
                        <Text className="text-red-700 dark:text-red-300 text-sm font-medium">
                          Revoke
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}
          />
        )}
      </View>
    </View>
  );
}
