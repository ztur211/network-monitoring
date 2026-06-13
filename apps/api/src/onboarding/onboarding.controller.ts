import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticatedUser } from '@nodescope/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrgId } from '../organizations/decorators/org-id.decorator';
import { OnboardingTurnDto } from './onboarding.dto';
import { OnboardingService } from './onboarding.service';

@Controller('v1/onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post('turn')
  @HttpCode(HttpStatus.OK)
  async turn(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: OnboardingTurnDto,
    @Req() req: Request,
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? '0.0.0.0';
    const data = await this.onboardingService.handleTurn(orgId, user.id, ip, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post('skip')
  @HttpCode(HttpStatus.OK)
  async skip(@CurrentUser() user: AuthenticatedUser) {
    await this.onboardingService.skip(user.id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
