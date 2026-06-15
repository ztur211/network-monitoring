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
import { OrgMember } from '../organizations/decorators/org-member.decorator';
import { OrgMemberContext } from '../organizations/org-context.types';
import { CreateConnectionDto, PatchConnectionDto } from './connections.dto';
import { ConnectionsService } from './connections.service';

@Controller('v1/device-connections')
export class ConnectionsController {
  constructor(private readonly connectionsService: ConnectionsService) {}

  @Get()
  async listConnections(
    @OrgMember() member: OrgMemberContext,
    @Query('deviceId') deviceId?: string,
  ) {
    const data = await this.connectionsService.listConnections(member, deviceId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createConnection(
    @OrgMember() member: OrgMemberContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateConnectionDto,
  ) {
    const data = await this.connectionsService.createConnection(member, user.id, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  async updateConnection(
    @OrgMember() member: OrgMemberContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() patch: PatchConnectionDto,
  ) {
    const data = await this.connectionsService.updateConnection(member, id, patch);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  async deleteConnection(
    @OrgMember() member: OrgMemberContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.connectionsService.deleteConnection(member, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
