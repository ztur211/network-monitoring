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
import { OrgRoles } from '../organizations/decorators/org-roles.decorator';
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
  async listDevices(@OrgId() orgId: string) {
    const data = await this.devicesService.listDevices(orgId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post()
  @OrgRoles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  async createDevice(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDeviceDto,
  ) {
    const data = await this.devicesService.createDevice(orgId, user.id, dto);
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
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.devicesService.getDevice(orgId, id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  @OrgRoles('OWNER', 'ADMIN')
  async updateDevice(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() patch: PatchDeviceDto,
  ) {
    const data = await this.devicesService.updateDevice(orgId, id, patch);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  @OrgRoles('OWNER', 'ADMIN')
  async deleteDevice(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.devicesService.deleteDevice(orgId, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
