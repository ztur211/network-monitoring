import { Controller, Get, Req } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionUser } from '@nodescope/shared';
import { OrgId } from '../organizations/decorators/org-id.decorator';
import { ClientsService } from './clients.service';

@Controller('v1/clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  async getClients(@CurrentUser() user: SessionUser, @OrgId() orgId: string, @Req() req: Request) {
    const userAgent = req.headers['user-agent'] ?? '';
    const data = await this.clientsService.getClients(orgId, user.id, userAgent);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
