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
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@nodescope/shared';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { OrgMember } from '../organizations/decorators/org-member.decorator';
import { OrgMemberContext } from '../organizations/org-context.types';
import { CreateCircuitDto, ListCircuitsQueryDto, PatchCircuitDto } from './circuits.dto';
import { CircuitsService } from './circuits.service';

@Controller('v1/circuits')
export class CircuitsController {
  constructor(private readonly circuitsService: CircuitsService) {}

  @Get()
  async listCircuits(
    @OrgMember() member: OrgMemberContext,
    @Query() query: ListCircuitsQueryDto,
  ) {
    const data = await this.circuitsService.listCircuits(member, query);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  async createCircuit(
    @OrgMember() member: OrgMemberContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCircuitDto,
  ) {
    const data = await this.circuitsService.createCircuit(member, user.id, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get(':id')
  async getCircuit(
    @OrgMember() member: OrgMemberContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.circuitsService.getCircuit(member, id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  async updateCircuit(
    @OrgMember() member: OrgMemberContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() patch: PatchCircuitDto,
  ) {
    const data = await this.circuitsService.updateCircuit(member, id, patch);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  async deleteCircuit(
    @OrgMember() member: OrgMemberContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.circuitsService.deleteCircuit(member, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
