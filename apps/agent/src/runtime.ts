import type { ProbeResult } from '@nodescope/probe';
import type { AgentClient } from './api-client.js';
import type { Buffer } from './buffer.js';
import { reachabilityCollector, pollDevices } from './poller.js';
import { snmpCollector } from './collectors/snmp-collector.js';
import type { SnmpSessionFactory } from './collectors/snmp-collector.js';

export async function runCycle(deps: {
  client: AgentClient;
  buffer: Buffer;
  probe: (ip: string) => Promise<ProbeResult>;
  concurrency: number;
  snmpFactory: SnmpSessionFactory;
}): Promise<void> {
  const devices = await deps.client.syncDevices();
  const collectors = [
    reachabilityCollector(deps.probe),
    snmpCollector(deps.snmpFactory),
  ];
  const batch = await pollDevices(devices, collectors, deps.concurrency);
  deps.buffer.enqueue(batch);
  // Liveness must not be coupled to data delivery: drain() re-throws on a transient ingest
  // failure (5xx/429/network), but the heartbeat must still go out or the backend starts
  // marking a healthy agent offline. Run it in finally so a failed drain can't skip it.
  try {
    await deps.buffer.drain(deps.client.ingest);
  } finally {
    await deps.client.heartbeat();
  }
}
