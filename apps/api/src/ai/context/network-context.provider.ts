import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NetworkContextProvider {
  constructor(private readonly prisma: PrismaService) {}

  async getContext(userId: string): Promise<string> {
    const [devices, connections, fiberRuns, circuits] = await Promise.all([
      this.prisma.device.findMany({
        where: { userId },
        select: {
          name: true, category: true, ipAddress: true, floor: true, floorLabel: true, notes: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.deviceConnection.findMany({
        where: { userId },
        select: {
          connectionType: true, notes: true,
          sourceDevice: { select: { name: true } },
          targetDevice: { select: { name: true } },
        },
      }),
      this.prisma.fiberRun.findMany({
        where: { userId },
        select: {
          name: true, cableType: true, lengthMeters: true, notes: true,
          startDevice: { select: { name: true } },
          endDevice: { select: { name: true } },
        },
      }),
      this.prisma.circuit.findMany({
        where: { userId },
        select: {
          ispName: true, circuitId: true, serviceType: true, bandwidth: true, notes: true,
          device: { select: { name: true } },
        },
      }),
    ]);

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
