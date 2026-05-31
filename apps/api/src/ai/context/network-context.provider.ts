import { Injectable } from '@nestjs/common';
import { NetworkContextRepository } from './network-context.repository';

@Injectable()
export class NetworkContextProvider {
  constructor(private readonly repository: NetworkContextRepository) {}

  async getContext(userId: string): Promise<string> {
    const { devices, connections, fiberRuns, circuits } =
      await this.repository.getNetworkEntities(userId);

    const lines: string[] = ['## Documented Network'];

    if (devices.length === 0) {
      lines.push('No devices documented yet.');
    } else {
      lines.push(`### Devices (${devices.length})`);
      for (const d of devices) {
        let line = `- ${d.name} [${d.category}]`;
        if (d.ipAddress) line += ` IP:${d.ipAddress}`;
        if (d.floor != null) line += ` Floor:${d.floorLabel ?? d.floor}`;
        if (d.notes) line += ` — ${d.notes}`;
        lines.push(line);
      }
    }

    if (connections.length > 0) {
      lines.push(`### Connections (${connections.length})`);
      for (const c of connections) {
        lines.push(`- ${c.sourceDevice.name} → ${c.targetDevice.name} [${c.connectionType}]`);
      }
    }

    if (fiberRuns.length > 0) {
      lines.push(`### Fiber Runs (${fiberRuns.length})`);
      for (const f of fiberRuns) {
        let line = `- ${f.name}: ${f.startDevice.name} → ${f.endDevice.name}`;
        if (f.cableType) line += ` (${f.cableType})`;
        if (f.lengthMeters) line += ` ${f.lengthMeters}m`;
        lines.push(line);
      }
    }

    if (circuits.length > 0) {
      lines.push(`### ISP Circuits (${circuits.length})`);
      for (const c of circuits) {
        let line = `- ${c.ispName} ${c.serviceType}`;
        if (c.bandwidth) line += ` ${c.bandwidth}Mbps`;
        if (c.circuitId) line += ` (ID: ${c.circuitId})`;
        if (c.device) line += ` → terminates on ${c.device.name}`;
        lines.push(line);
      }
    }

    return lines.join('\n');
  }
}
