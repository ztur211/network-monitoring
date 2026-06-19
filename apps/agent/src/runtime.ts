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
  await deps.buffer.drain(deps.client.ingest);
  await deps.client.heartbeat();
}
