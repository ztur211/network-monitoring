import { Controller, Get, HttpStatus } from '@nestjs/common';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { OrgId } from '../organizations/decorators/org-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@nodescope/shared';
import { PermissionsRepository } from './permissions.repository';
import { PermissionsService } from './permissions.service';

@Controller('v1/access')
export class PermissionsController {
  constructor(
    private readonly service: PermissionsService,
    private readonly repo: PermissionsRepository,
  ) {}

  @Get('me')
  async myAccess(@OrgId() organizationId: string, @CurrentUser() user: AuthenticatedUser) {
    const member = await this.repo.findMember(organizationId, user.id);
    if (!member) throw new NodeScopeException('ORG_001', 'NOT_A_MEMBER', HttpStatus.NOT_FOUND);
    const data = await this.service.accessSummary(member);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
