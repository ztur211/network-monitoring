import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { OrgMember } from '../organizations/decorators/org-member.decorator';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { AddMemberPropertyDto } from './permissions.dto';
import { PermissionsService } from './permissions.service';

@Controller('v1/members/:memberId')
export class MemberAssignmentsController {
  constructor(private readonly service: PermissionsService) {}

  @Get('access')
  async access(
    @OrgMember() actor: OrgMemberContext,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return { success: true, data: await this.service.memberAccessAsSeenBy(actor, memberId), timestamp: new Date().toISOString() };
  }

  @Post('properties')
  @HttpCode(HttpStatus.CREATED)
  async grant(
    @OrgMember() actor: OrgMemberContext,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: AddMemberPropertyDto,
  ) {
    return { success: true, data: await this.service.grantSiteToMember(actor, memberId, dto.propertyId), timestamp: new Date().toISOString() };
  }

  @Delete('properties/:propertyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @OrgMember() actor: OrgMemberContext,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    await this.service.revokeSiteFromMember(actor, memberId, propertyId);
  }
}
