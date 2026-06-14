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
import { OrgId } from '../organizations/decorators/org-id.decorator';
import { OrgRoles } from '../organizations/decorators/org-roles.decorator';
import { CreateCircuitDto, ListCircuitsQueryDto, PatchCircuitDto } from './circuits.dto';
import { CircuitsService } from './circuits.service';

@Controller('v1/circuits')
export class CircuitsController {
  constructor(private readonly circuitsService: CircuitsService) {}

  @Get()
  async listCircuits(
    @OrgId() orgId: string,
    @Query() query: ListCircuitsQueryDto,
  ) {
    const data = await this.circuitsService.listCircuits(orgId, query);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  @OrgRoles('OWNER', 'ADMIN')
  async createCircuit(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCircuitDto,
  ) {
    const data = await this.circuitsService.createCircuit(orgId, user.id, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get(':id')
  async getCircuit(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.circuitsService.getCircuit(orgId, id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  @OrgRoles('OWNER', 'ADMIN')
  async updateCircuit(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() patch: PatchCircuitDto,
  ) {
    const data = await this.circuitsService.updateCircuit(orgId, id, patch);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  @OrgRoles('OWNER', 'ADMIN')
  async deleteCircuit(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.circuitsService.deleteCircuit(orgId, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
