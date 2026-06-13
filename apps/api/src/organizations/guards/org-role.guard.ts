import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { ORG_ROLES_KEY } from '../decorators/org-roles.decorator';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

@Injectable()
export class OrgRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<OrgRole[]>(ORG_ROLES_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const request = context.switchToHttp().getRequest();
    if (!request.orgMember) {
      throw new NodeScopeException('ORG_002', 'NOT_AN_ORG_MEMBER', HttpStatus.FORBIDDEN);
    }
    if (!required.includes(request.orgMember.role)) {
      throw new NodeScopeException('ORG_003', 'INSUFFICIENT_ORG_ROLE', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}
