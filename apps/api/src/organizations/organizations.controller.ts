import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@nodescope/shared';
import { OrgContextGuard } from './guards/org-context.guard';
import { OrgRoleGuard } from './guards/org-role.guard';
import { OrgRoles } from './decorators/org-roles.decorator';
import { OrgId } from './decorators/org-id.decorator';
import { OrganizationsService } from './organizations.service';
import { PatchOrganizationDto } from './organizations.dto';

@Controller('v1/organizations')
@UseGuards(AuthGuard, OrgContextGuard, OrgRoleGuard)
export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  @Get('me')
  async myOrg(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.service.getMyOrganization(user.id), timestamp: new Date().toISOString() };
  }

  @Get('me/members')
  async myMembers(@OrgId() orgId: string) {
    return { success: true, data: await this.service.getMyMembers(orgId), timestamp: new Date().toISOString() };
  }

  @Patch('me')
  @OrgRoles('OWNER', 'ADMIN')
  async updateMyOrg(@OrgId() orgId: string, @Body() patch: PatchOrganizationDto) {
    return { success: true, data: await this.service.updateMyOrganization(orgId, patch), timestamp: new Date().toISOString() };
  }
}
