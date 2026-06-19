import type { ProbeResult } from '@nodescope/probe';
import type { AgentClient } from './api-client.js';
import type { Buffer } from './buffer.js';
import { reachabilityCollector, pollDevices } from './poller.js';

export async function runCycle(deps: { client: AgentClient; buffer: Buffer; probe: (ip: string) => Promise<ProbeResult>; concurrency: number }): Promise<void> {
  const devices = await deps.client.syncDevices();
  const batch = await pollDevices(devices, [reachabilityCollector(deps.probe)], deps.concurrency);
  deps.buffer.enqueue(batch);
  await deps.buffer.drain(deps.client.ingest);
  await deps.client.heartbeat();
}
