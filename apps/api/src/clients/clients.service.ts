import { Injectable } from '@nestjs/common';
import { MetricsDto } from '@nodescope/shared';
import { DataSourcesService } from '../data-sources/data-sources.service';

interface CurrentDeviceDto {
  userAgent: string;
  platform: string | null;
  metrics: MetricsDto | null;
}

interface AgentStatusDto {
  available: false;
  message: string;
}

export interface ClientsResponseDto {
  currentDevice: CurrentDeviceDto;
  agentStatus: AgentStatusDto;
}

const AGENT_UNAVAILABLE_MESSAGE =
  'Desktop Agent coming post-MVP (Priority 1). Once available, it will provide 24/7 network monitoring, active device discovery, and latency pinging — even when NodeScope is not open.';

@Injectable()
export class ClientsService {
  constructor(private readonly dataSourcesService: DataSourcesService) {}

  async getClients(organizationId: string, userId: string, userAgent: string): Promise<ClientsResponseDto> {
    const latestMetric = await this.dataSourcesService.getLatestMetric(organizationId, userId);

    const metrics: MetricsDto | null = latestMetric
      ? {
          bandwidthDown: latestMetric.bandwidthDown,
          bandwidthUp: latestMetric.bandwidthUp,
          latency: latestMetric.latency,
          connectionQuality: latestMetric.connectionQuality,
          timestamp: latestMetric.timestamp,
        }
      : null;

    return {
      currentDevice: {
        userAgent,
        platform: parsePlatform(userAgent),
        metrics,
      },
      agentStatus: {
        available: false,
        message: AGENT_UNAVAILABLE_MESSAGE,
      },
    };
  }
}

function parsePlatform(userAgent: string): string | null {
  if (/windows/i.test(userAgent)) return 'Windows';
  if (/mac os x/i.test(userAgent)) return 'macOS';
  if (/linux/i.test(userAgent)) return 'Linux';
  if (/android/i.test(userAgent)) return 'Android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS';
  return null;
}
