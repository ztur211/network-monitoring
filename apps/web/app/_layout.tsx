import { useEffect } from 'react';
import { Stack } from 'expo-router';
import '../global.css';
import { authClient } from '../lib/auth-client';
import { useAuthStore } from '../store/auth.store';
import type { SessionUser } from '@nodescope/shared';

export default function RootLayout() {
  const { setUser, setLoading } = useAuthStore();

  useEffect(() => {
    authClient.getSession().then((result) => {
      setUser(result.data?.user ? (result.data.user as SessionUser) : null);
      setLoading(false);
    }).catch(() => {
      setUser(null);
      setLoading(false);
    });
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}
