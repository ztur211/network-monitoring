import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { OrgRoleGuard } from './guards/org-role.guard';
import { OrgRoles } from './decorators/org-roles.decorator';
import { OrgId } from './decorators/org-id.decorator';
import { OrgMemberRole } from './decorators/org-member-role.decorator';
import { OrganizationsService } from './organizations.service';
import { ChangeMemberRoleDto } from './membership.dto';

@Controller('v1/organizations/me/members')
@UseGuards(OrgRoleGuard)
@OrgRoles('OWNER', 'ADMIN')
export class MembersController {
  constructor(private readonly service: OrganizationsService) {}

  @Patch(':userId')
  @HttpCode(HttpStatus.OK)
  async changeRole(
    @OrgId() orgId: string,
    @OrgMemberRole() actorRole: OrgRole,
    @Param('userId') userId: string,
    @Body() dto: ChangeMemberRoleDto,
  ) {
    await this.service.changeMemberRole(orgId, actorRole, userId, dto.role);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @OrgId() orgId: string,
    @OrgMemberRole() actorRole: OrgRole,
    @Param('userId') userId: string,
  ) {
    await this.service.removeMember(orgId, actorRole, userId);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
