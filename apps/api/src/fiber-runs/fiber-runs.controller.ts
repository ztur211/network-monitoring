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
import { CreateFiberRunDto, PatchFiberRunDto } from './fiber-runs.dto';
import { FiberRunsService } from './fiber-runs.service';

@Controller('v1/fiber-runs')
export class FiberRunsController {
  constructor(private readonly fiberRunsService: FiberRunsService) {}

  @Get()
  async listFiberRuns(
    @CurrentUser() user: AuthenticatedUser,
    @Query('deviceId') deviceId?: string,
  ) {
    const data = await this.fiberRunsService.listFiberRuns(user.id, deviceId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createFiberRun(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFiberRunDto) {
    const data = await this.fiberRunsService.createFiberRun(user.id, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get(':id')
  async getFiberRun(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.fiberRunsService.getFiberRun(user.id, id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  async updateFiberRun(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() patch: PatchFiberRunDto,
  ) {
    const data = await this.fiberRunsService.updateFiberRun(user.id, id, patch);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  async deleteFiberRun(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.fiberRunsService.deleteFiberRun(user.id, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
