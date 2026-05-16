import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_ROLE_KEY } from '../decorators/require-role.decorator';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRole = this.reflector.getAllAndOverride<string>(REQUIRED_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRole) return true;

    // Organization plugin is post-MVP (Priority 4). Guard is structurally complete
    // but no active endpoints use @RequireRole in MVP.
    const request = context.switchToHttp().getRequest();
    const userRole: string | undefined = request.user?.orgRole;

    if (!userRole) {
      throw new ForbiddenException({ code: 'AUTH_004', message: 'INSUFFICIENT_ROLE' });
    }

    return true;
  }
}
