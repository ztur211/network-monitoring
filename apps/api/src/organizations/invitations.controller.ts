import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser, InvitationDto } from '@nodescope/shared';
import { OrgRoleGuard } from './guards/org-role.guard';
import { OrgRoles } from './decorators/org-roles.decorator';
import { OrgId } from './decorators/org-id.decorator';
import { OrgMemberRole } from './decorators/org-member-role.decorator';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './membership.dto';
import type { Invitation, OrgRole } from '@prisma/client';

function toInvitationDto(inv: Invitation): InvitationDto {
  return {
    id: inv.id,
    email: inv.email,
    role: inv.role,
    expiresAt: inv.expiresAt.toISOString(),
    acceptedAt: inv.acceptedAt ? inv.acceptedAt.toISOString() : null,
    createdAt: inv.createdAt.toISOString(),
  };
}

@Controller('v1/organizations/me/invitations')
@UseGuards(OrgRoleGuard)
@OrgRoles('OWNER', 'ADMIN')
export class InvitationsController {
  constructor(
    private readonly service: InvitationsService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvitationDto,
    @OrgMemberRole() actorRole: OrgRole,
  ) {
    const { invitation, token } = await this.service.create(orgId, dto.email, dto.role, user.id, actorRole);
    const url = `${this.config.get('FRONTEND_URL')}/invite/${token}`;
    return {
      success: true,
      data: { invitation: toInvitationDto(invitation), token, url },
      timestamp: new Date().toISOString(),
    };
  }

  @Get()
  async list(@OrgId() orgId: string) {
    const invitations = await this.service.listPending(orgId);
    return {
      success: true,
      data: invitations.map(toInvitationDto),
      timestamp: new Date().toISOString(),
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async revoke(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.service.revoke(orgId, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
