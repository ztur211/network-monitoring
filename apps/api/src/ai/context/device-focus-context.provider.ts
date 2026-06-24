import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsRepository } from '../../permissions/permissions.repository';
import { PermissionsService } from '../../permissions/permissions.service';
import { MonitoringRepository } from '../../monitoring/monitoring.repository';

const METRIC_CAP = 6;
const METRIC_BUCKET = '5 minutes';
const EVENT_LIMIT = 10;

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(1) : '?';
}

/**
 * Assembles a `## Focused Device` markdown section for the AI.
 * Returns '' when the device is not visible to the requesting user (org mismatch or F3 scope).
 * DO NOT register in the module yet — that is Task 3.
 */
@Injectable()
export class DeviceFocusContextProvider {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionsRepo: PermissionsRepository,
    private readonly permissions: PermissionsService,
    private readonly monitoringRepo: MonitoringRepository,
  ) {}

  async getContext(organizationId: string, userId: string, deviceId: string): Promise<string> {
    // --- Step 1: Visibility gate (device must exist in this org) ---
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, organizationId },
      select: { name: true, category: true, ipAddress: true, floor: true, floorLabel: true, propertyId: true },
    });
    if (!device) return '';

    // --- Step 2: Member + F3 scope check ---
    const member = await this.permissionsRepo.findMember(organizationId, userId);
    if (!member) return '';

    if (
      member.role !== 'OWNER' &&
      !(await this.permissions.inScope(organizationId, member.id, device.propertyId))
    ) {
      return '';
    }

    // --- Step 3: Fetch live data in parallel ---
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600_000);

    const [statusRows, metricNames, events, connections] = await Promise.all([
      this.monitoringRepo.listStatus(organizationId, [deviceId]),
      this.monitoringRepo.metricNames(organizationId, deviceId, oneHourAgo),
      this.monitoringRepo.recentStatusEvents(organizationId, deviceId, EVENT_LIMIT),
      this.prisma.deviceConnection.findMany({
        where: {
          organizationId,
          OR: [{ sourceDeviceId: deviceId }, { targetDeviceId: deviceId }],
        },
        select: {
          connectionType: true,
          sourceDevice: { select: { name: true } },
          targetDevice: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // --- Step 4: Assemble markdown ---
    const lines: string[] = ['## Focused Device'];

    // Device info line
    let infoLine = `- **${device.name}** [${device.category}]`;
    if (device.ipAddress) infoLine += ` IP:${device.ipAddress}`;
    if (device.floor != null) infoLine += ` Floor:${device.floorLabel ?? device.floor}`;
    lines.push(infoLine);
    lines.push('');

    // Current status
    lines.push('### Current Status');
    const status = statusRows.find((s) => s.deviceId === deviceId);
    if (status) {
      const latencyStr = status.latencyMs != null ? `${status.latencyMs}ms` : 'n/a';
      const changedStr = status.lastChangeAt ? status.lastChangeAt.toISOString() : 'n/a';
      lines.push(`- State: ${status.state} | Latency: ${latencyStr} | Last change: ${changedStr}`);
    } else {
      lines.push('- State: UNKNOWN');
    }
    lines.push('');

    // Recent metrics (last 1h)
    lines.push('### Recent Metrics (last 1h)');
    const cappedMetrics = metricNames.slice(0, METRIC_CAP);
    if (cappedMetrics.length === 0) {
      lines.push('- no recent data');
    } else {
      for (const metric of cappedMetrics) {
        const rows = await this.monitoringRepo.queryMetric(
          organizationId,
          deviceId,
          metric,
          oneHourAgo,
          now,
          METRIC_BUCKET,
        );
        if (rows.length === 0) {
          lines.push(`- ${metric}: no recent data`);
        } else {
          const values = rows.map((r) => Number(r.avg)).filter(Number.isFinite);
          if (values.length === 0) {
            lines.push(`- ${metric}: no recent data`);
          } else {
            const last = values[values.length - 1];
            const min = Math.min(...values);
            const max = Math.max(...values);
            const avg = values.reduce((a, b) => a + b, 0) / values.length;
            lines.push(`- ${metric}: last=${fmt(last)} min=${fmt(min)} max=${fmt(max)} avg=${fmt(avg)}`);
          }
        }
      }
    }
    lines.push('');

    // Recent status events
    lines.push('### Recent Events');
    if (events.length === 0) {
      lines.push('- none recorded');
    } else {
      for (const e of events) {
        lines.push(`- ${e.time.toISOString()} → ${e.state} (${e.source})`);
      }
    }
    lines.push('');

    // Connections
    lines.push('### Connections');
    if (connections.length === 0) {
      lines.push('- none recorded');
    } else {
      for (const c of connections) {
        lines.push(`- ${c.sourceDevice.name} → ${c.targetDevice.name} [${c.connectionType}]`);
      }
    }

    return lines.join('\n');
  }
}
