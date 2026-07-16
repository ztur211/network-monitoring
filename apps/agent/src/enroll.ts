import type { AgentEnrollResponse } from '@nodescope/shared';
import type { Credentials } from './credentials.js';
import { fetchWithTimeout } from './fetch-with-timeout.js';

export async function enroll(o: { apiUrl: string; code: string; name: string; platform: string; version: string; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<Credentials> {
  const f = o.fetchImpl ?? fetch;
  return fetchWithTimeout({
    fetchImpl: f,
    input: `${o.apiUrl}/v1/monitoring/agent/enroll`,
    timeoutMs: o.timeoutMs,
    init: {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: o.code, name: o.name, platform: o.platform, version: o.version }),
    },
    consume: async (res) => {
      if (!res.ok) throw new Error(`enroll failed: ${res.status}`);
      const env = await res.json() as { success: boolean; data: AgentEnrollResponse };
      return { agentId: env.data.agentId, token: env.data.token };
    },
  });
}
