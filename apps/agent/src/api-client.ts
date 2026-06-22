import { gzipSync } from 'node:zlib';
import type { AgentDeviceDto, IngestBatchDto } from '@nodescope/shared';

// Gzip ingest bodies at/above this size; smaller payloads aren't worth the ~20-byte overhead.
const INGEST_GZIP_MIN_BYTES = 1024;

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
    async ingest(batch) {
      const json = JSON.stringify(batch);
      // Compress larger batches on the wire; the API auto-inflates (express.json inflate:true).
      const init: RequestInit =
        Buffer.byteLength(json) >= INGEST_GZIP_MIN_BYTES
          ? { method: 'POST', body: gzipSync(json), headers: { 'content-encoding': 'gzip' } }
          : { method: 'POST', body: json };
      await call('/v1/monitoring/ingest', init);
    },
    async heartbeat() { await call('/v1/monitoring/agent/heartbeat', { method: 'POST', body: '{}' }); },
  };
}
