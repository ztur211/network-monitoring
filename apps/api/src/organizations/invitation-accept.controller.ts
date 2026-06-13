import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@nodescope/shared';
import { InvitationsService } from './invitations.service';
import { AcceptInvitationDto } from './membership.dto';

@Controller('v1/invitations')
export class InvitationAcceptController {
  constructor(private readonly service: InvitationsService) {}

  @Post('accept')
  @HttpCode(HttpStatus.CREATED)
  async accept(@CurrentUser() user: AuthenticatedUser, @Body() dto: AcceptInvitationDto) {
    await this.service.accept(user.id, user.email, dto.token);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
