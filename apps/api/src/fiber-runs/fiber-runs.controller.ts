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
import { CreateFiberRunDto, PatchFiberRunDto } from './fiber-runs.dto';
import { FiberRunsService } from './fiber-runs.service';

@Controller('v1/fiber-runs')
export class FiberRunsController {
  constructor(private readonly fiberRunsService: FiberRunsService) {}

  @Get()
  async listFiberRuns(
    @OrgId() orgId: string,
    @Query('deviceId') deviceId?: string,
  ) {
    const data = await this.fiberRunsService.listFiberRuns(orgId, deviceId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createFiberRun(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFiberRunDto,
  ) {
    const data = await this.fiberRunsService.createFiberRun(orgId, user.id, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get(':id')
  async getFiberRun(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.fiberRunsService.getFiberRun(orgId, id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  async updateFiberRun(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() patch: PatchFiberRunDto,
  ) {
    const data = await this.fiberRunsService.updateFiberRun(orgId, id, patch);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  async deleteFiberRun(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.fiberRunsService.deleteFiberRun(orgId, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
