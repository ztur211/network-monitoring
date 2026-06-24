import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { OrgMember } from '../../organizations/decorators/org-member.decorator';
import type { OrgMemberContext } from '../../organizations/org-context.types';
import { MonitoringService } from './monitoring.service';

@Controller('v1')
export class MonitoringController {
  constructor(private readonly svc: MonitoringService) {}

  // Spec 7: F3-scoped current status for a building's in-scope devices (Spec 4's initial load).
  @Get('buildings/:propertyId/device-status')
  async status(@OrgMember() member: OrgMemberContext, @Param('propertyId', ParseUUIDPipe) propertyId: string) {
    const data = await this.svc.getBuildingDeviceStatus(member, propertyId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  // Spec 7: F3-scoped bucketed metric series for a single device (charts).
  @Get('devices/:id/metrics')
  async metrics(
    @OrgMember() member: OrgMemberContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('metric') metric: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('bucket') bucket = '5 minutes',
  ) {
    const data = await this.svc.getDeviceMetrics(member, id, metric, new Date(from), new Date(to), bucket);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  // Spec A: F3-scoped distinct metric names for a device (last 24h).
  @Get('devices/:id/metric-names')
  async metricNames(@OrgMember() member: OrgMemberContext, @Param('id', ParseUUIDPipe) id: string) {
    const data = await this.svc.getDeviceMetricNames(member, id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  // Spec A: F3-scoped recent status transitions for a device (newest-first, capped).
  @Get('devices/:id/status-events')
  async statusEvents(
    @OrgMember() member: OrgMemberContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit = '50',
  ) {
    const data = await this.svc.getDeviceStatusEvents(member, id, Number(limit));
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
