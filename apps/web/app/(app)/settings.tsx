import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { useColorScheme } from 'nativewind';
import { useAuthStore } from '../../store/auth.store';
import { api } from '../../lib/api.service';
import type { UserDto } from '@nodescope/shared';

interface DataSourceStatus {
  type: string;
  connected: boolean;
  lastSeen: string | null;
  message: string;
}

export default function SettingsScreen() {
  const { user, setUser } = useAuthStore();
  const { colorScheme, setColorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Profile editing
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Location
  const [address, setAddress] = useState('');
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);

  // Data sources
  const [sources, setSources] = useState<DataSourceStatus[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState(false);

  useEffect(() => {
    void loadDataSources();
  }, []);

  const loadDataSources = async () => {
    setSourcesLoading(true);
    setSourcesError(false);
    try {
      const res = await api.get<{ success: true; data: { sources: DataSourceStatus[] } }>(
        '/users/me/data-sources',
      );
      setSources(res.data.data.sources);
    } catch {
      setSourcesError(true);
    } finally {
      setSourcesLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!name.trim() && !email.trim()) return;
    setIsSavingProfile(true);
    setProfileError(null);

    const payload: { name?: string; email?: string } = {};
    if (name.trim() !== (user?.name ?? '')) payload.name = name.trim();
    if (email.trim() !== (user?.email ?? '')) payload.email = email.trim().toLowerCase();

    if (Object.keys(payload).length === 0) {
      setIsSavingProfile(false);
      return;
    }

    try {
      const res = await api.patch<{ success: true; data: UserDto }>('/users/me', payload);
      if (user) {
        setUser({ ...user, name: res.data.data.name, email: res.data.data.email });
      }
      if (typeof window !== 'undefined') {
        window.alert('Profile updated successfully.');
      }
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data
        ?.error?.code;
      if (code === 'AUTH_005') {
        setProfileError('That email address is already in use.');
      } else {
        setProfileError('Failed to save profile. Please try again.');
      }
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSaveLocation = async () => {
    if (!address.trim()) return;
    setIsSavingLocation(true);
    setLocationMessage(null);

    try {
      const res = await api.post<{
        success: true;
        data: { latitude: number; longitude: number; address: string | null };
      }>('/users/location', { address: address.trim() });
      const { latitude, longitude } = res.data.data;
      setLocationMessage(`Location set: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
      setAddress('');

      // Update stored user with new location
      if (user) {
        setUser({ ...user, homeLatitude: latitude, homeLongitude: longitude });
      }
    } catch {
      setLocationMessage('Geocoding failed. Try a more specific address.');
    } finally {
      setIsSavingLocation(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-white dark:bg-gray-900">
      {/* Header */}
      <View className="px-4 pt-12 pb-3 border-b border-gray-200 dark:border-gray-700">
        <Text className="text-2xl font-bold text-gray-900 dark:text-white">Settings</Text>
      </View>

      {/* Profile Section */}
      <View className="px-4 mt-6">
        <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
          Account
        </Text>
        <View className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor="#9ca3af"
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
            />
          </View>

          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="your@email.com"
              placeholderTextColor="#9ca3af"
              keyboardType="email-address"
              autoCapitalize="none"
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white"
            />
          </View>

          {profileError && (
            <Text className="text-red-500 dark:text-red-400 text-sm mb-3">{profileError}</Text>
          )}

          <TouchableOpacity
            onPress={() => void handleSaveProfile()}
            disabled={isSavingProfile}
            className={`rounded-lg py-2.5 items-center ${
              isSavingProfile ? 'bg-blue-400' : 'bg-blue-600'
            }`}
          >
            {isSavingProfile ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Text className="text-white font-medium">Save Profile</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Location Section */}
      <View className="px-4 mt-6">
        <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
          Home Location
        </Text>
        <View className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
          <Text className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            The map centers on your home location when you first open it.
          </Text>

          {user?.homeLatitude !== null && user?.homeLatitude !== undefined && (
            <View className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2 mb-3">
              <Text className="text-sm text-green-700 dark:text-green-300">
                Current: {user.homeLatitude.toFixed(5)}, {user.homeLongitude?.toFixed(5)}
              </Text>
            </View>
          )}

          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="Enter address to geocode..."
            placeholderTextColor="#9ca3af"
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-white mb-3"
          />

          {locationMessage && (
            <Text
              className={`text-sm mb-3 ${
                locationMessage.startsWith('Location set')
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-500 dark:text-red-400'
              }`}
            >
              {locationMessage}
            </Text>
          )}

          <TouchableOpacity
            onPress={() => void handleSaveLocation()}
            disabled={isSavingLocation || !address.trim()}
            className={`rounded-lg py-2.5 items-center ${
              isSavingLocation || !address.trim() ? 'bg-blue-300 dark:bg-blue-800' : 'bg-blue-600'
            }`}
          >
            {isSavingLocation ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Text className="text-white font-medium">Set Location</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Appearance Section */}
      <View className="px-4 mt-6">
        <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
          Appearance
        </Text>
        <View className="bg-gray-50 dark:bg-gray-800 rounded-xl overflow-hidden">
          <View className="flex-row items-center justify-between px-4 py-3.5">
            <Text className="text-base text-gray-900 dark:text-white">Dark Mode</Text>
            <Switch
              value={isDark}
              onValueChange={(val) => setColorScheme(val ? 'dark' : 'light')}
              trackColor={{ false: '#d1d5db', true: '#2563eb' }}
              thumbColor="white"
            />
          </View>
        </View>
      </View>

      {/* Data Sources Section */}
      <View className="px-4 mt-6 mb-8">
        <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
          Data Sources
        </Text>
        <View className="bg-gray-50 dark:bg-gray-800 rounded-xl overflow-hidden">
          {sourcesLoading ? (
            <View className="py-6 items-center">
              <ActivityIndicator size="small" color="#6b7280" />
            </View>
          ) : sourcesError ? (
            <View className="px-4 py-4 flex-row items-center justify-between">
              <Text className="text-sm text-red-500 dark:text-red-400 flex-1">
                Failed to load data sources.
              </Text>
              <TouchableOpacity
                onPress={() => void loadDataSources()}
                className="bg-blue-600 px-3 py-1.5 rounded-lg ml-3"
              >
                <Text className="text-white text-sm font-medium">Retry</Text>
              </TouchableOpacity>
            </View>
          ) : sources.length === 0 ? (
            <View className="px-4 py-4">
              <Text className="text-sm text-gray-500 dark:text-gray-400">
                No data sources configured.
              </Text>
            </View>
          ) : (
            sources.map((source, idx) => (
              <View
                key={source.type}
                className={`flex-row items-center px-4 py-3.5 ${
                  idx < sources.length - 1 ? 'border-b border-gray-200 dark:border-gray-700' : ''
                }`}
              >
                <View
                  className={`w-2 h-2 rounded-full mr-3 ${
                    source.connected ? 'bg-green-500' : 'bg-gray-400'
                  }`}
                />
                <View className="flex-1">
                  <Text className="text-base text-gray-900 dark:text-white capitalize">
                    {source.type === 'browser' ? 'Browser Collector' : source.type}
                  </Text>
                  <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {source.message}
                  </Text>
                  {source.lastSeen && (
                    <Text className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      Last seen: {new Date(source.lastSeen).toLocaleString()}
                    </Text>
                  )}
                </View>
                <View
                  className={`px-2 py-0.5 rounded-full ${
                    source.connected
                      ? 'bg-green-100 dark:bg-green-900/40'
                      : 'bg-gray-100 dark:bg-gray-700'
                  }`}
                >
                  <Text
                    className={`text-xs font-medium ${
                      source.connected
                        ? 'text-green-700 dark:text-green-300'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {source.connected ? 'Active' : 'Not set up'}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </View>
    </ScrollView>
  );
}
