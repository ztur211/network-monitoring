import { Controller, Get, Req } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionUser } from '@nodescope/shared';
import { ClientsService } from './clients.service';

@Controller('v1/clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  async getClients(@CurrentUser() user: SessionUser, @Req() req: Request) {
    const userAgent = req.headers['user-agent'] ?? '';
    return this.clientsService.getClients(user.id, userAgent);
  }
}
