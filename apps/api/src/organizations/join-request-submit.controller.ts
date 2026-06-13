import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@nodescope/shared';
import { JoinRequestsService } from './join-requests.service';

@Controller('v1/join-requests')
export class JoinRequestSubmitController {
  constructor(private readonly service: JoinRequestsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async submit(@CurrentUser() user: AuthenticatedUser) {
    await this.service.submit(user.id, user.email);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
