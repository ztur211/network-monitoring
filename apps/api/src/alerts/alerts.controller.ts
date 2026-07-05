import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { OrgId } from '../organizations/decorators/org-id.decorator';
import { OrgRoles } from '../organizations/decorators/org-roles.decorator';
import { AlertsService } from './alerts.service';
import { CreateChannelDto, CreateRuleDto } from './alerts.dto';

const ok = (data: unknown) => ({ success: true, data, timestamp: new Date().toISOString() });

@Controller('v1/alerts')
export class AlertsController {
  constructor(private readonly svc: AlertsService) {}

  @Post('channels') @OrgRoles('OWNER', 'ADMIN')
  async createChannel(@OrgId() orgId: string, @Body() dto: CreateChannelDto) { return ok(await this.svc.createChannel(orgId, dto)); }
  @Get('channels') @OrgRoles('OWNER', 'ADMIN')
  async listChannels(@OrgId() orgId: string) { return ok(await this.svc.listChannels(orgId)); }
  @Delete('channels/:id') @OrgRoles('OWNER', 'ADMIN') @HttpCode(200)
  async deleteChannel(@OrgId() orgId: string, @Param('id') id: string) { await this.svc.deleteChannel(orgId, id); return ok({ id }); }
  @Post('channels/:id/test') @OrgRoles('OWNER', 'ADMIN')
  async testChannel(@OrgId() orgId: string, @Param('id') id: string) { await this.svc.testChannel(orgId, id); return ok({ sent: true }); }

  @Post('rules') @OrgRoles('OWNER', 'ADMIN')
  async createRule(@OrgId() orgId: string, @Body() dto: CreateRuleDto) { return ok(await this.svc.createRule(orgId, dto)); }
  @Get('rules') @OrgRoles('OWNER', 'ADMIN')
  async listRules(@OrgId() orgId: string) { return ok(await this.svc.listRules(orgId)); }
  @Delete('rules/:id') @OrgRoles('OWNER', 'ADMIN') @HttpCode(200)
  async deleteRule(@OrgId() orgId: string, @Param('id') id: string) { await this.svc.deleteRule(orgId, id); return ok({ id }); }

  @Get('events') @OrgRoles('OWNER', 'ADMIN')
  async listEvents(@OrgId() orgId: string) { return ok(await this.svc.listEvents(orgId)); }
}
