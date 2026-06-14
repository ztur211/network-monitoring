import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { OrgContextGuard } from '../organizations/guards/org-context.guard';
import { OrgRoleGuard } from '../organizations/guards/org-role.guard';
import { OrgMember } from '../organizations/decorators/org-member.decorator';
import { NetworkPropertyService } from './network-property.service';
import { AddCharterDto } from './network-property.dto';
import type { OrgMemberContext } from '../organizations/org-context.types';

@Controller('v1/networks/:networkId/properties')
@UseGuards(AuthGuard, OrgContextGuard, OrgRoleGuard)
export class NetworkPropertyController {
  constructor(private readonly service: NetworkPropertyService) {}

  @Get()
  async list(
    @OrgMember() member: OrgMemberContext,
    @Param('networkId', ParseUUIDPipe) networkId: string,
  ) {
    return {
      success: true,
      data: await this.service.list(member, networkId),
      timestamp: new Date().toISOString(),
    };
  }

  @Post()
  async add(
    @OrgMember() member: OrgMemberContext,
    @Param('networkId', ParseUUIDPipe) networkId: string,
    @Body() dto: AddCharterDto,
  ) {
    return {
      success: true,
      data: await this.service.add(member, networkId, dto.propertyId),
      timestamp: new Date().toISOString(),
    };
  }

  @Delete(':propertyId')
  async remove(
    @OrgMember() member: OrgMemberContext,
    @Param('networkId', ParseUUIDPipe) networkId: string,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    await this.service.remove(member, networkId, propertyId);
    return {
      success: true,
      data: null,
      timestamp: new Date().toISOString(),
    };
  }
}
