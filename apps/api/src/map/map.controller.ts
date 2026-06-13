import { Controller, Get, Query } from '@nestjs/common';
import { OrgId } from '../organizations/decorators/org-id.decorator';
import { MapBboxQueryDto } from './map.dto';
import { MapService } from './map.service';

@Controller('v1/map')
export class MapController {
  constructor(private readonly mapService: MapService) {}

  @Get('devices')
  async getDevices(@OrgId() orgId: string, @Query() query: MapBboxQueryDto) {
    const data = await this.mapService.getDevicesInBbox(orgId, query.bbox, query.floor);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get('fiber-runs')
  async getFiberRuns(@OrgId() orgId: string, @Query() query: MapBboxQueryDto) {
    const data = await this.mapService.getFiberRunsInBbox(orgId, query.bbox);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get('circuits')
  async getCircuits(@OrgId() orgId: string, @Query() query: MapBboxQueryDto) {
    const data = await this.mapService.getCircuitsInBbox(orgId, query.bbox);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
