import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@nodescope/shared';
import { OrgId } from '../organizations/decorators/org-id.decorator';
import { CreateConnectionDto, PatchConnectionDto } from './connections.dto';
import { ConnectionsService } from './connections.service';

@Controller('v1/device-connections')
export class ConnectionsController {
  constructor(private readonly connectionsService: ConnectionsService) {}

  @Get()
  async listConnections(
    @OrgId() orgId: string,
    @Query('deviceId') deviceId?: string,
  ) {
    const data = await this.connectionsService.listConnections(orgId, deviceId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createConnection(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateConnectionDto,
  ) {
    const data = await this.connectionsService.createConnection(orgId, user.id, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  async updateConnection(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() patch: PatchConnectionDto,
  ) {
    const data = await this.connectionsService.updateConnection(orgId, id, patch);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  async deleteConnection(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.connectionsService.deleteConnection(orgId, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
