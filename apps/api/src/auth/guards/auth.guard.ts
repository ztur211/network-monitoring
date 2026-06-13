import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../better-auth.config';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { auditAls } from '../../audit/audit.als';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    if (!session) {
      throw new UnauthorizedException({ code: 'AUTH_002', message: 'SESSION_INVALID' });
    }

    request.user = session.user;
    request.session = session.session;

    const auditStore = auditAls.getStore();
    if (auditStore) auditStore.userId = (session.user as { id: string }).id;

    return true;
  }
}
