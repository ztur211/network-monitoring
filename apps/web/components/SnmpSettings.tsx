/**
 * SnmpSettings — presentational component for SNMP configuration in org settings.
 *
 * Covers:
 *  - List existing SNMP credentials (name + version; secrets are never shown)
 *  - Create a new credential (name + snmpVersion picker + write-only community/authKey/privKey)
 *  - Delete a credential
 *  - List OID profiles (name + includeInterfaceMetrics)
 *  - Create a new OID profile
 *  - Assign a credential + profile to a network or device
 *
 * All server interaction goes through the injected `client` prop so this
 * component is fully presentational and testable without a real API.
 *
 * NOTE: No component render test exists for this file — the repo has no
 * RN-component test infrastructure (no @testing-library/react, no
 * react-test-renderer). Client methods are covered by api.service.snmp.spec.ts.
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
  SnmpCredentialDto,
  CreateSnmpCredentialDto,
  OidProfileDto,
  CreateOidProfileDto,
  SnmpVersionDto,
} from '@nodescope/shared';
import type { AssignSnmpPayload } from '../lib/api.service';

// ─── Client interface ─────────────────────────────────────────────────────────

export interface SnmpClient {
  listSnmpCredentials(): Promise<SnmpCredentialDto[]>;
  createSnmpCredential(dto: CreateSnmpCredentialDto): Promise<SnmpCredentialDto>;
  deleteSnmpCredential(id: string): Promise<void>;
  listOidProfiles(): Promise<OidProfileDto[]>;
  createOidProfile(dto: CreateOidProfileDto): Promise<OidProfileDto>;
  assignSnmp(dto: AssignSnmpPayload): Promise<void>;
}

interface Props {
  client: SnmpClient;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SnmpSettings({ client }: Props) {
  // Credentials
  const [creds, setCreds] = useState<SnmpCredentialDto[]>([]);
  const [credsLoading, setCredsLoading] = useState(true);
  const [credsError, setCredsError] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Create credential form
  const [newCredName, setNewCredName] = useState('');
  const [newCredVersion, setNewCredVersion] = useState<SnmpVersionDto>('V2C');
  const [newCommunity, setNewCommunity] = useState('');
  const [creatingCred, setCreatingCred] = useState(false);
  const [createCredError, setCreateCredError] = useState<string | null>(null);

  // OID profiles
  const [profiles, setProfiles] = useState<OidProfileDto[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState(false);

  // Create OID profile form
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileIfMetrics, setNewProfileIfMetrics] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [createProfileError, setCreateProfileError] = useState<string | null>(null);

  // Assignment
  const [assignTargetType, setAssignTargetType] = useState<'network' | 'device'>('network');
  const [assignTargetId, setAssignTargetId] = useState('');
  const [assignCredId, setAssignCredId] = useState('');
  const [assignProfileId, setAssignProfileId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);

  // ── Load ──

  const loadCreds = async () => {
    setCredsLoading(true);
    setCredsError(false);
    try {
      const data = await client.listSnmpCredentials();
      setCreds(data);
    } catch {
      setCredsError(true);
    } finally {
      setCredsLoading(false);
    }
  };

  const loadProfiles = async () => {
    setProfilesLoading(true);
    setProfilesError(false);
    try {
      const data = await client.listOidProfiles();
      setProfiles(data);
    } catch {
      setProfilesError(true);
    } finally {
      setProfilesLoading(false);
    }
  };

  useEffect(() => {
    void loadCreds();
    void loadProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handlers ──

  const handleCreateCredential = async () => {
    if (!newCredName.trim()) return;
    setCreatingCred(true);
    setCreateCredError(null);
    try {
      const dto: CreateSnmpCredentialDto = {
        name: newCredName.trim(),
        snmpVersion: newCredVersion,
        ...(newCredVersion === 'V2C' && newCommunity.trim()
          ? { community: newCommunity.trim() }
          : {}),
      };
      const created = await client.createSnmpCredential(dto);
      setCreds((prev) => [...prev, created]);
      setNewCredName('');
      setNewCommunity('');
      setNewCredVersion('V2C');
    } catch {
      setCreateCredError('Failed to create credential. Please try again.');
    } finally {
      setCreatingCred(false);
    }
  };

  const handleDeleteCredential = async (id: string) => {
    setDeletingId(id);
    try {
      await client.deleteSnmpCredential(id);
      setCreds((prev) => prev.filter((c) => c.id !== id));
    } catch {
      if (typeof window !== 'undefined') {
        window.alert('Failed to delete credential. It may be assigned to a device or network.');
      }
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreateProfile = async () => {
    if (!newProfileName.trim()) return;
    setCreatingProfile(true);
    setCreateProfileError(null);
    try {
      const dto: CreateOidProfileDto = {
        name: newProfileName.trim(),
        includeInterfaceMetrics: newProfileIfMetrics,
      };
      const created = await client.createOidProfile(dto);
      setProfiles((prev) => [...prev, created]);
      setNewProfileName('');
      setNewProfileIfMetrics(false);
    } catch {
      setCreateProfileError('Failed to create OID profile. Please try again.');
    } finally {
      setCreatingProfile(false);
    }
  };

  const handleAssign = async () => {
    if (!assignTargetId.trim()) return;
    setAssigning(true);
    setAssignMessage(null);
    try {
      await client.assignSnmp({
        targetType: assignTargetType,
        targetId: assignTargetId.trim(),
        snmpCredentialId: assignCredId || null,
        oidProfileId: assignProfileId || null,
      });
      setAssignMessage('Assignment saved.');
      setAssignTargetId('');
      setAssignCredId('');
      setAssignProfileId('');
    } catch {
      setAssignMessage('Assignment failed. Please try again.');
    } finally {
      setAssigning(false);
    }
  };

  // ── Render ──

  return (
    <View className="px-4 mt-6 mb-2">
      <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
        SNMP
      </Text>

      {/* ── Credentials section ── */}
      <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        Credentials
      </Text>

      {/* Existing credentials list */}
      <View className="bg-gray-50 dark:bg-gray-800 rounded-xl overflow-hidden mb-4">
        {credsLoading ? (
          <View className="py-6 items-center">
            <ActivityIndicator size="small" color="#6b7280" />
          </View>
        ) : credsError ? (
          <View className="px-4 py-4 flex-row items-center justify-between">
            <Text className="text-sm text-red-500 dark:text-red-400 flex-1">
              Failed to load credentials.
            </Text>
            <TouchableOpacity
              onPress={() => void loadCreds()}
              className="bg-blue-600 px-3 py-1.5 rounded-lg ml-3"
            >
              <Text className="text-white text-sm font-medium">Retry</Text>
            </TouchableOpacity>
          </View>
        ) : creds.length === 0 ? (
          <View className="px-4 py-4">
            <Text className="text-sm text-gray-500 dark:text-gray-400">
              No SNMP credentials configured.
            </Text>
          </View>
        ) : (
          <FlatList
            data={creds}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            renderItem={({ item: cred, index }) => (
              <View
                className={`px-4 py-3.5 flex-row items-center justify-between ${
                  index < creds.length - 1 ? 'border-b border-gray-200 dark:border-gray-700' : ''
                }`}
              >
                <View className="flex-1 mr-3">
                  <Text className="text-base font-medium text-gray-900 dark:text-white">
                    {cred.name}
                  </Text>
                  <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {cred.snmpVersion}
                    {cred.hasCommunity ? ' · community set' : ''}
                    {cred.hasAuthKey ? ' · auth key set' : ''}
                    {cred.hasPrivKey ? ' · priv key set' : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => void handleDeleteCredential(cred.id)}
                  disabled={deletingId === cred.id}
                  className={`rounded-lg px-3 py-1.5 ${
                    deletingId === cred.id
                      ? 'bg-red-300 dark:bg-red-900'
                      : 'bg-red-100 dark:bg-red-900/40'
                  }`}
                >
                  {deletingId === cred.id ? (
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

      {/* Create credential form */}
      <View className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-6">
        <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Add Credential
        </Text>

        <View className="mb-3">
          <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">Name</Text>
          <TextInput
            value={newCredName}
            onChangeText={setNewCredName}
            placeholder="e.g. datacenter-v2c"
            placeholderTextColor="#9ca3af"
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
          />
        </View>

        {/* Version picker — simple toggle between V2C / V3 */}
        <View className="mb-3 flex-row">
          {(['V2C', 'V3'] as SnmpVersionDto[]).map((v) => (
            <TouchableOpacity
              key={v}
              onPress={() => setNewCredVersion(v)}
              className={`mr-2 px-4 py-2 rounded-lg border ${
                newCredVersion === v
                  ? 'bg-blue-600 border-blue-600'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
              }`}
            >
              <Text
                className={`text-sm font-medium ${
                  newCredVersion === v ? 'text-white' : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                {v}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* V2C: community string (write-only) */}
        {newCredVersion === 'V2C' && (
          <View className="mb-3">
            <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              Community String (write-only)
            </Text>
            <TextInput
              value={newCommunity}
              onChangeText={setNewCommunity}
              placeholder="public"
              placeholderTextColor="#9ca3af"
              secureTextEntry
              autoComplete="off"
              autoCorrect={false}
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
            />
          </View>
        )}

        {/* V3: note that full V3 params can be extended later */}
        {newCredVersion === 'V3' && (
          <View className="mb-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg px-3 py-2">
            <Text className="text-xs text-yellow-700 dark:text-yellow-300">
              SNMPv3 credentials (security name, auth/priv keys) can be set via the API. This form
              creates a named v3 credential — extend it with full v3 fields as needed.
            </Text>
          </View>
        )}

        {createCredError && (
          <Text className="text-red-500 dark:text-red-400 text-sm mb-3">{createCredError}</Text>
        )}

        <TouchableOpacity
          onPress={() => void handleCreateCredential()}
          disabled={creatingCred || !newCredName.trim()}
          className={`rounded-lg py-2.5 items-center ${
            creatingCred || !newCredName.trim() ? 'bg-blue-400' : 'bg-blue-600'
          }`}
        >
          {creatingCred ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text className="text-white font-medium">Add Credential</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* ── OID Profiles section ── */}
      <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        OID Profiles
      </Text>

      {/* Existing profiles list */}
      <View className="bg-gray-50 dark:bg-gray-800 rounded-xl overflow-hidden mb-4">
        {profilesLoading ? (
          <View className="py-6 items-center">
            <ActivityIndicator size="small" color="#6b7280" />
          </View>
        ) : profilesError ? (
          <View className="px-4 py-4 flex-row items-center justify-between">
            <Text className="text-sm text-red-500 dark:text-red-400 flex-1">
              Failed to load OID profiles.
            </Text>
            <TouchableOpacity
              onPress={() => void loadProfiles()}
              className="bg-blue-600 px-3 py-1.5 rounded-lg ml-3"
            >
              <Text className="text-white text-sm font-medium">Retry</Text>
            </TouchableOpacity>
          </View>
        ) : profiles.length === 0 ? (
          <View className="px-4 py-4">
            <Text className="text-sm text-gray-500 dark:text-gray-400">
              No OID profiles configured.
            </Text>
          </View>
        ) : (
          <FlatList
            data={profiles}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            renderItem={({ item: profile, index }) => (
              <View
                className={`px-4 py-3.5 ${
                  index < profiles.length - 1
                    ? 'border-b border-gray-200 dark:border-gray-700'
                    : ''
                }`}
              >
                <Text className="text-base font-medium text-gray-900 dark:text-white">
                  {profile.name}
                </Text>
                <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {profile.includeInterfaceMetrics ? 'Interface metrics: on' : 'Interface metrics: off'}
                  {profile.entries.length > 0 ? ` · ${profile.entries.length} OID entries` : ''}
                </Text>
              </View>
            )}
          />
        )}
      </View>

      {/* Create OID profile form */}
      <View className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-6">
        <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Add OID Profile
        </Text>

        <View className="mb-3">
          <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">Profile Name</Text>
          <TextInput
            value={newProfileName}
            onChangeText={setNewProfileName}
            placeholder="e.g. standard-interface"
            placeholderTextColor="#9ca3af"
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
          />
        </View>

        <View className="mb-4 flex-row items-center justify-between">
          <Text className="text-sm text-gray-700 dark:text-gray-300">
            Include Interface Metrics
          </Text>
          <Switch
            value={newProfileIfMetrics}
            onValueChange={setNewProfileIfMetrics}
            trackColor={{ false: '#d1d5db', true: '#2563eb' }}
            thumbColor="white"
          />
        </View>

        {createProfileError && (
          <Text className="text-red-500 dark:text-red-400 text-sm mb-3">{createProfileError}</Text>
        )}

        <TouchableOpacity
          onPress={() => void handleCreateProfile()}
          disabled={creatingProfile || !newProfileName.trim()}
          className={`rounded-lg py-2.5 items-center ${
            creatingProfile || !newProfileName.trim() ? 'bg-blue-400' : 'bg-blue-600'
          }`}
        >
          {creatingProfile ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text className="text-white font-medium">Add OID Profile</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Assignment section ── */}
      <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        Assign to Network / Device
      </Text>

      <View className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-4">
        <Text className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Assign a credential and/or OID profile to a specific network or device by ID.
        </Text>

        {/* Target type toggle */}
        <View className="mb-3 flex-row">
          {(['network', 'device'] as const).map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setAssignTargetType(t)}
              className={`mr-2 px-4 py-2 rounded-lg border ${
                assignTargetType === t
                  ? 'bg-blue-600 border-blue-600'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
              }`}
            >
              <Text
                className={`text-sm font-medium capitalize ${
                  assignTargetType === t ? 'text-white' : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View className="mb-3">
          <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            {assignTargetType === 'network' ? 'Network ID' : 'Device ID'}
          </Text>
          <TextInput
            value={assignTargetId}
            onChangeText={setAssignTargetId}
            placeholder="uuid"
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
          />
        </View>

        <View className="mb-3">
          <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            Credential (leave blank to unassign)
          </Text>
          <TextInput
            value={assignCredId}
            onChangeText={setAssignCredId}
            placeholder="credential uuid or leave blank"
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
          />
        </View>

        <View className="mb-4">
          <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            OID Profile (leave blank to unassign)
          </Text>
          <TextInput
            value={assignProfileId}
            onChangeText={setAssignProfileId}
            placeholder="profile uuid or leave blank"
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
          />
        </View>

        {assignMessage && (
          <Text
            className={`text-sm mb-3 ${
              assignMessage === 'Assignment saved.'
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-500 dark:text-red-400'
            }`}
          >
            {assignMessage}
          </Text>
        )}

        <TouchableOpacity
          onPress={() => void handleAssign()}
          disabled={assigning || !assignTargetId.trim()}
          className={`rounded-lg py-2.5 items-center ${
            assigning || !assignTargetId.trim() ? 'bg-blue-400' : 'bg-blue-600'
          }`}
        >
          {assigning ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text className="text-white font-medium">Save Assignment</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
