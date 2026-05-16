import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_TIER_KEY } from '../decorators/require-tier.decorator';

const TIER_ORDER: Record<string, number> = {
  PERSONAL_FREE: 0,
  PERSONAL_PAID: 1,
  MULTI_PROPERTY: 2,
  ENTERPRISE: 3,
};

@Injectable()
export class TierGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredTier = this.reflector.getAllAndOverride<string>(REQUIRED_TIER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredTier) return true;

    const request = context.switchToHttp().getRequest();
    const userTier: string = request.user?.tier ?? 'PERSONAL_FREE';

    if ((TIER_ORDER[userTier] ?? 0) < (TIER_ORDER[requiredTier] ?? 0)) {
      throw new ForbiddenException({ code: 'AUTH_003', message: 'INSUFFICIENT_TIER' });
    }

    return true;
  }
}
