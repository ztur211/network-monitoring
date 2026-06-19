import type { AgentDeviceDto, IngestBatchDto } from '@nodescope/shared';

export class AgentHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'AgentHttpError';
  }
}

export interface AgentClient {
  syncDevices(): Promise<AgentDeviceDto[]>;
  ingest(batch: IngestBatchDto): Promise<void>;
  heartbeat(): Promise<void>;
}

export function createAgentClient(o: { apiUrl: string; token: string; fetchImpl?: typeof fetch }): AgentClient {
  const f = o.fetchImpl ?? fetch;
  const headers = { 'content-type': 'application/json', 'x-agent-token': o.token };
  const call = async (path: string, init?: RequestInit) => {
    const res = await f(`${o.apiUrl}${path}`, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) } });
    if (!res.ok) throw new AgentHttpError(res.status, `${init?.method ?? 'GET'} ${path} → ${res.status}`);
    return (await res.json()) as { data: unknown };
  };
  return {
    async syncDevices() { return (await call('/v1/monitoring/agent/devices')).data as AgentDeviceDto[]; },
    async ingest(batch) { await call('/v1/monitoring/ingest', { method: 'POST', body: JSON.stringify(batch) }); },
    async heartbeat() { await call('/v1/monitoring/agent/heartbeat', { method: 'POST', body: '{}' }); },
  };
}
