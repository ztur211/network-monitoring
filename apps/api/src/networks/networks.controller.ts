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
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@nodescope/shared';
import { OrgMember } from '../organizations/decorators/org-member.decorator';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { CreateNetworkDto, PatchNetworkDto } from './networks.dto';
import { NetworksService } from './networks.service';

@Controller('v1/networks')
export class NetworksController {
  constructor(private readonly networksService: NetworksService) {}

  @Get()
  async listNetworks(@OrgMember() member: OrgMemberContext) {
    const data = await this.networksService.listNetworks(member);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createNetwork(
    @OrgMember() member: OrgMemberContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateNetworkDto,
  ) {
    const data = await this.networksService.createNetwork(member, user.id, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get(':id')
  async getNetwork(
    @OrgMember() member: OrgMemberContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.networksService.getNetwork(member, id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  async updateNetwork(
    @OrgMember() member: OrgMemberContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() patch: PatchNetworkDto,
  ) {
    const data = await this.networksService.updateNetwork(member, id, patch);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post(':id/set-home-ip')
  @HttpCode(HttpStatus.OK)
  async setHomeIp(
    @OrgMember() member: OrgMemberContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? '0.0.0.0';
    const data = await this.networksService.setHomeIpFromRequest(member, id, ip);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  async deleteNetwork(
    @OrgMember() member: OrgMemberContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.networksService.deleteNetwork(member, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
