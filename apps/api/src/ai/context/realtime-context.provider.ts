import { Injectable } from '@nestjs/common';
import { DataSourcesService } from '../../data-sources/data-sources.service';

@Injectable()
export class RealtimeContextProvider {
  constructor(private readonly dataSourcesService: DataSourcesService) {}

  async getContext(organizationId: string, userId: string): Promise<string> {
    const metric = await this.dataSourcesService.getLatestMetric(organizationId, userId);

    const lines = ['## Realtime Context'];
    lines.push(
      'Note: These metrics reflect only the browser session where NodeScope is open.',
      'They do not represent all devices on your network.',
    );

    if (metric) {
      const ageMs = Date.now() - new Date(metric.timestamp).getTime();
      const ageSec = Math.floor(ageMs / 1000);
      const ageLabel = ageSec < 60 ? `${ageSec}s ago` : `${Math.floor(ageSec / 60)}m ago`;

      lines.push(`Last browser metric: ${ageLabel}`);
      if (metric.latency != null) lines.push(`Latency: ${metric.latency}ms`);
      if (metric.bandwidthDown != null) lines.push(`Download: ${metric.bandwidthDown.toFixed(1)} Mbps`);
      if (metric.bandwidthUp != null) lines.push(`Upload: ${metric.bandwidthUp.toFixed(1)} Mbps`);
      if (metric.connectionQuality) lines.push(`Connection quality: ${metric.connectionQuality}`);
    } else {
      lines.push('No browser metrics collected yet in this session.');
    }

    lines.push('For device-level metrics, the Desktop Agent is a planned future feature.');

    return lines.join('\n');
  }
}
