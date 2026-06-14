import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { OrgContextGuard } from '../organizations/guards/org-context.guard';
import { OrgRoleGuard } from '../organizations/guards/org-role.guard';
import { OrgRoles } from '../organizations/decorators/org-roles.decorator';
import { OrgId } from '../organizations/decorators/org-id.decorator';
import { NetworkPropertyService } from './network-property.service';
import { AddCharterDto } from './network-property.dto';

@Controller('v1/networks/:networkId/properties')
@UseGuards(AuthGuard, OrgContextGuard, OrgRoleGuard)
export class NetworkPropertyController {
  constructor(private readonly service: NetworkPropertyService) {}

  @Get()
  async list(
    @OrgId() orgId: string,
    @Param('networkId', ParseUUIDPipe) networkId: string,
  ) {
    return {
      success: true,
      data: await this.service.list(orgId, networkId),
      timestamp: new Date().toISOString(),
    };
  }

  @Post()
  @OrgRoles('OWNER', 'ADMIN')
  async add(
    @OrgId() orgId: string,
    @Param('networkId', ParseUUIDPipe) networkId: string,
    @Body() dto: AddCharterDto,
  ) {
    return {
      success: true,
      data: await this.service.add(orgId, networkId, dto.propertyId),
      timestamp: new Date().toISOString(),
    };
  }

  @Delete(':propertyId')
  @OrgRoles('OWNER', 'ADMIN')
  async remove(
    @OrgId() orgId: string,
    @Param('networkId', ParseUUIDPipe) networkId: string,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    await this.service.remove(orgId, networkId, propertyId);
    return {
      success: true,
      data: null,
      timestamp: new Date().toISOString(),
    };
  }
}
