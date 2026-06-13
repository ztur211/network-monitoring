import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (!request.user?.isSuperAdmin) {
      throw new NodeScopeException('ORG_007', 'SUPERADMIN_REQUIRED', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}
