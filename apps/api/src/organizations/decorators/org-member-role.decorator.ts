import { createParamDecorator, ExecutionContext, HttpStatus } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

export const OrgMemberRole = createParamDecorator((_data: unknown, ctx: ExecutionContext): OrgRole => {
  const request = ctx.switchToHttp().getRequest();
  if (!request.orgMember) {
    throw new NodeScopeException('ORG_002', 'NOT_AN_ORG_MEMBER', HttpStatus.FORBIDDEN);
  }
  return request.orgMember.role;
});
