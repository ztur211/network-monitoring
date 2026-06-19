import { readFileSync } from 'node:fs';

export interface AgentConfig {
  apiUrl: string; syncIntervalMs: number; probeIntervalMs: number;
  concurrency: number; ports: number[]; icmpEnabled: boolean; timeoutMs: number;
}
const num = (v: string | undefined, d: number) => (v != null ? Number(v) : d);

export function loadConfig(opts?: { configPath?: string; env?: Record<string, string | undefined> }): AgentConfig {
  const env = opts?.env ?? process.env;
  const path = opts?.configPath ?? env.NODESCOPE_AGENT_CONFIG ?? '/etc/nodescope-agent/config.json';
  let file: Partial<AgentConfig> = {};
  try { file = JSON.parse(readFileSync(path, 'utf8')); } catch { /* defaults */ }
  return {
    apiUrl: env.NODESCOPE_AGENT_API_URL ?? file.apiUrl ?? 'http://localhost:3000/api',
    syncIntervalMs: num(env.NODESCOPE_AGENT_SYNC_INTERVAL_MS, file.syncIntervalMs ?? 300000),
    probeIntervalMs: num(env.NODESCOPE_AGENT_PROBE_INTERVAL_MS, file.probeIntervalMs ?? 30000),
    concurrency: num(env.NODESCOPE_AGENT_CONCURRENCY, file.concurrency ?? 20),
    ports: (env.NODESCOPE_AGENT_PORTS ?? file.ports?.join(',') ?? '443,80,22').split(',').map((p) => Number(String(p).trim())),
    icmpEnabled: (env.NODESCOPE_AGENT_ICMP ?? String(file.icmpEnabled ?? true)) !== 'false',
    timeoutMs: num(env.NODESCOPE_AGENT_TIMEOUT_MS, file.timeoutMs ?? 2000),
  };
}
