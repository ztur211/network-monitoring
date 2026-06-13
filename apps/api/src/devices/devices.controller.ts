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
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@nodescope/shared';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { OrgId } from '../organizations/decorators/org-id.decorator';
import { CreateDeviceDto, PatchDeviceDto } from './devices.dto';
import { DevicesService } from './devices.service';

@Controller('v1/devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  async listDevices(@OrgId() orgId: string) {
    const data = await this.devicesService.listDevices(orgId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post()
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

  @Get(':id')
  async getDevice(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.devicesService.getDevice(orgId, id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  async updateDevice(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() patch: PatchDeviceDto,
  ) {
    const data = await this.devicesService.updateDevice(orgId, id, patch);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  async deleteDevice(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.devicesService.deleteDevice(orgId, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
