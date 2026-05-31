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
import { CreateCircuitDto, ListCircuitsQueryDto, PatchCircuitDto } from './circuits.dto';
import { CircuitsService } from './circuits.service';

@Controller('v1/circuits')
export class CircuitsController {
  constructor(private readonly circuitsService: CircuitsService) {}

  @Get()
  async listCircuits(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCircuitsQueryDto,
  ) {
    const data = await this.circuitsService.listCircuits(user.id, query);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  async createCircuit(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCircuitDto) {
    const data = await this.circuitsService.createCircuit(user.id, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get(':id')
  async getCircuit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.circuitsService.getCircuit(user.id, id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  async updateCircuit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() patch: PatchCircuitDto,
  ) {
    const data = await this.circuitsService.updateCircuit(user.id, id, patch);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  async deleteCircuit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.circuitsService.deleteCircuit(user.id, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
