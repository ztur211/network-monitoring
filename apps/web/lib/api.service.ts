import axios from 'axios';

const apiUrl =
  typeof process !== 'undefined' && process.env.EXPO_PUBLIC_API_URL
    ? process.env.EXPO_PUBLIC_API_URL
    : 'http://localhost:3000';

export const api = axios.create({
  baseURL: `${apiUrl}/api/v1`,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      error.response?.data?.error?.code === 'AUTH_002' &&
      typeof window !== 'undefined'
    ) {
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);
