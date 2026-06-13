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
import { OrgId } from '../organizations/decorators/org-id.decorator';
import { CreateNetworkDto, PatchNetworkDto } from './networks.dto';
import { NetworksService } from './networks.service';

@Controller('v1/networks')
export class NetworksController {
  constructor(private readonly networksService: NetworksService) {}

  @Get()
  async listNetworks(@OrgId() orgId: string) {
    const data = await this.networksService.listNetworks(orgId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createNetwork(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateNetworkDto,
  ) {
    const data = await this.networksService.createNetwork(orgId, user.id, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get(':id')
  async getNetwork(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.networksService.getNetwork(orgId, id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  async updateNetwork(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() patch: PatchNetworkDto,
  ) {
    const data = await this.networksService.updateNetwork(orgId, id, patch);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post(':id/set-home-ip')
  @HttpCode(HttpStatus.OK)
  async setHomeIp(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? '0.0.0.0';
    const data = await this.networksService.setHomeIpFromRequest(orgId, id, ip);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  async deleteNetwork(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.networksService.deleteNetwork(orgId, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
