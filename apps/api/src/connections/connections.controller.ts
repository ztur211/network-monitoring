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
import { CreateConnectionDto, PatchConnectionDto } from './connections.dto';
import { ConnectionsService } from './connections.service';

@Controller('v1/device-connections')
export class ConnectionsController {
  constructor(private readonly connectionsService: ConnectionsService) {}

  @Get()
  async listConnections(
    @CurrentUser() user: AuthenticatedUser,
    @Query('deviceId') deviceId?: string,
  ) {
    const data = await this.connectionsService.listConnections(user.id, deviceId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createConnection(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateConnectionDto) {
    const data = await this.connectionsService.createConnection(user.id, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  async updateConnection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() patch: PatchConnectionDto,
  ) {
    const data = await this.connectionsService.updateConnection(user.id, id, patch);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  async deleteConnection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.connectionsService.deleteConnection(user.id, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
