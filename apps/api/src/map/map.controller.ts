import { Controller, Get, Query } from '@nestjs/common';
import { OrgMember } from '../organizations/decorators/org-member.decorator';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { MapBboxQueryDto } from './map.dto';
import { MapService } from './map.service';

@Controller('v1/map')
export class MapController {
  constructor(private readonly mapService: MapService) {}

  @Get('devices')
  async getDevices(@OrgMember() member: OrgMemberContext, @Query() query: MapBboxQueryDto) {
    const data = await this.mapService.getDevicesInBbox(member, query.bbox, query.floor);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get('fiber-runs')
  async getFiberRuns(@OrgMember() member: OrgMemberContext, @Query() query: MapBboxQueryDto) {
    const data = await this.mapService.getFiberRunsInBbox(member, query.bbox);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get('circuits')
  async getCircuits(@OrgMember() member: OrgMemberContext, @Query() query: MapBboxQueryDto) {
    const data = await this.mapService.getCircuitsInBbox(member, query.bbox);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
