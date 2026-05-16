import { createAuthClient } from 'better-auth/react';

const apiUrl =
  typeof process !== 'undefined' && process.env.EXPO_PUBLIC_API_URL
    ? process.env.EXPO_PUBLIC_API_URL
    : 'http://localhost:3000';

export const authClient = createAuthClient({
  baseURL: apiUrl,
  fetchOptions: { credentials: 'include' },
});
