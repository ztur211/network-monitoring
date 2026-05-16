import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@nodescope/shared';
import { MapBboxQueryDto } from './map.dto';
import { MapService } from './map.service';

@Controller('v1/map')
export class MapController {
  constructor(private readonly mapService: MapService) {}

  @Get('devices')
  async getDevices(@CurrentUser() user: AuthenticatedUser, @Query() query: MapBboxQueryDto) {
    const data = await this.mapService.getDevicesInBbox(user.id, query.bbox, query.floor);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get('fiber-runs')
  async getFiberRuns(@CurrentUser() user: AuthenticatedUser, @Query() query: MapBboxQueryDto) {
    const data = await this.mapService.getFiberRunsInBbox(user.id, query.bbox);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get('circuits')
  async getCircuits(@CurrentUser() user: AuthenticatedUser, @Query() query: MapBboxQueryDto) {
    const data = await this.mapService.getCircuitsInBbox(user.id, query.bbox);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
