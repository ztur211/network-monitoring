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
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@nodescope/shared';
import { CreateNetworkDto, PatchNetworkDto } from './networks.dto';
import { NetworksService } from './networks.service';

@Controller('v1/networks')
export class NetworksController {
  constructor(private readonly networksService: NetworksService) {}

  @Get()
  async listNetworks(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.networksService.listNetworks(user.id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createNetwork(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateNetworkDto,
  ) {
    const data = await this.networksService.createNetwork(user.id, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get(':id')
  async getNetwork(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.networksService.getNetwork(user.id, id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  async updateNetwork(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() patch: PatchNetworkDto,
  ) {
    const data = await this.networksService.updateNetwork(user.id, id, patch);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  async deleteNetwork(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.networksService.deleteNetwork(user.id, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
