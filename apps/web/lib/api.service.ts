import axios from 'axios';
import type { AgentDto } from '@nodescope/shared';

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

/** List all agents enrolled in the current org. */
export async function listAgents(): Promise<AgentDto[]> {
  const res = await api.get<{ success: true; data: AgentDto[] }>('/agents');
  return res.data.data;
}

/** Generate a one-time enrollment code for a new agent. */
export async function generateAgentCode(): Promise<{ code: string }> {
  const res = await api.post<{ success: true; data: { code: string } }>(
    '/agents/enrollment-code',
  );
  return res.data.data;
}

/** Revoke an enrolled agent by id. */
export async function revokeAgent(id: string): Promise<void> {
  await api.post(`/agents/${id}/revoke`);
}
