import type { ProbeResult } from '@nodescope/probe';
import type { AgentClient } from './api-client.js';
import type { Buffer } from './buffer.js';
import { chunkBatch, INGEST_MAX_ITEMS_PER_BATCH } from './buffer.js';
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
  // One cycle polls the WHOLE fleet, so this batch grows with the customer. Enqueue it as
  // server-sized chunks instead of one unbounded request that the API would (rightly) refuse.
  // Chunks are queued individually, so a partial failure only ever costs the chunks that failed.
  for (const chunk of chunkBatch(batch, INGEST_MAX_ITEMS_PER_BATCH)) deps.buffer.enqueue(chunk);
  // Liveness must not be coupled to data delivery: drain() re-throws on a transient ingest
  // failure (5xx/429/network), but the heartbeat must still go out or the backend starts
  // marking a healthy agent offline. Run it in finally so a failed drain can't skip it.
  try {
    await deps.buffer.drain(deps.client.ingest);
  } finally {
    await deps.client.heartbeat();
  }
}
