import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { DeviceCategory } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@nodescope/shared';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { OrgId } from '../organizations/decorators/org-id.decorator';
import { OrgMember } from '../organizations/decorators/org-member.decorator';
import { OrgMemberContext } from '../organizations/org-context.types';
import { CreateDeviceDto, PatchDeviceDto } from './devices.dto';
import { DevicesService } from './devices.service';
import { NameSuggestionService } from './name-suggestion.service';

@Controller('v1/devices')
export class DevicesController {
  constructor(
    private readonly devicesService: DevicesService,
    private readonly nameSuggestion: NameSuggestionService,
  ) {}

  @Get()
  async listDevices(@OrgMember() member: OrgMemberContext) {
    const data = await this.devicesService.listDevices(member);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  async createDevice(
    @OrgMember() member: OrgMemberContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDeviceDto,
  ) {
    const data = await this.devicesService.createDevice(member, user.id, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get('name-suggestion')
  async getNameSuggestion(
    @OrgId() orgId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('category', new ParseEnumPipe(DeviceCategory)) category: DeviceCategory,
    @Query('roleCode') roleCode?: string,
  ) {
    const suggestedName = await this.nameSuggestion.suggest(orgId, propertyId, category, roleCode ?? null);
    return { success: true, data: { suggestedName }, timestamp: new Date().toISOString() };
  }

  @Get(':id')
  async getDevice(
    @OrgMember() member: OrgMemberContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.devicesService.getDevice(member, id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  async updateDevice(
    @OrgMember() member: OrgMemberContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() patch: PatchDeviceDto,
  ) {
    const data = await this.devicesService.updateDevice(member, id, patch);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  async deleteDevice(
    @OrgMember() member: OrgMemberContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.devicesService.deleteDevice(member, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
