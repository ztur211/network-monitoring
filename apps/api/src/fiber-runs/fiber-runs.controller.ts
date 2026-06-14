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
import { CreateFiberRunDto, PatchFiberRunDto } from './fiber-runs.dto';
import { FiberRunsService } from './fiber-runs.service';

@Controller('v1/fiber-runs')
export class FiberRunsController {
  constructor(private readonly fiberRunsService: FiberRunsService) {}

  @Get()
  async listFiberRuns(
    @OrgMember() member: OrgMemberContext,
    @Query('deviceId') deviceId?: string,
  ) {
    const data = await this.fiberRunsService.listFiberRuns(member, deviceId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createFiberRun(
    @OrgMember() member: OrgMemberContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFiberRunDto,
  ) {
    const data = await this.fiberRunsService.createFiberRun(member, user.id, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get(':id')
  async getFiberRun(
    @OrgMember() member: OrgMemberContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.fiberRunsService.getFiberRun(member, id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  async updateFiberRun(
    @OrgMember() member: OrgMemberContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() patch: PatchFiberRunDto,
  ) {
    const data = await this.fiberRunsService.updateFiberRun(member, id, patch);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  async deleteFiberRun(
    @OrgMember() member: OrgMemberContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.fiberRunsService.deleteFiberRun(member, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
