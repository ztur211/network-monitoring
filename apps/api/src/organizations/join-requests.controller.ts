import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JoinRequestStatus } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser, JoinRequestDto } from '@nodescope/shared';
import { OrgRoleGuard } from './guards/org-role.guard';
import { OrgRoles } from './decorators/org-roles.decorator';
import { OrgId } from './decorators/org-id.decorator';
import { JoinRequestsService } from './join-requests.service';
import type { JoinRequest } from '@prisma/client';

function toJoinRequestDto(req: JoinRequest): JoinRequestDto {
  return {
    id: req.id,
    organizationId: req.organizationId,
    userId: req.userId,
    status: req.status,
    createdAt: req.createdAt.toISOString(),
    decidedAt: req.decidedAt ? req.decidedAt.toISOString() : null,
  };
}

@Controller('v1/organizations/me/join-requests')
@UseGuards(OrgRoleGuard)
@OrgRoles('OWNER', 'ADMIN')
export class JoinRequestsController {
  constructor(private readonly service: JoinRequestsService) {}

  @Get()
  async list(@OrgId() orgId: string, @Query('status') status?: string) {
    const requests = await this.service.list(orgId, (status as JoinRequestStatus) ?? 'PENDING');
    return {
      success: true,
      data: requests.map(toJoinRequestDto),
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.CREATED)
  async approve(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.decide(orgId, id, true, user.id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }

  @Post(':id/deny')
  @HttpCode(HttpStatus.CREATED)
  async deny(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.decide(orgId, id, false, user.id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
