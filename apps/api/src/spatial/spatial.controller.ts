import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { OrgMember } from '../organizations/decorators/org-member.decorator';
import { OrgRoles } from '../organizations/decorators/org-roles.decorator';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { SpatialService } from './spatial.service';
import { DevicePositionInputDto, DeviceIfcLinkInputDto } from './spatial.dto';

@Controller('v1/devices')
export class SpatialController {
  constructor(private readonly service: SpatialService) {}

  @Patch(':id/position')
  @OrgRoles('OWNER', 'ADMIN')
  async setPosition(
    @OrgMember() member: OrgMemberContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DevicePositionInputDto,
  ) {
    const data = await this.service.setPosition(member, id, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  // Link the device to a BIM element by its native IFC GlobalId (or clear it with null). The GUID is
  // the only join between the model and network data — see SpatialService.setIfcLink.
  @Patch(':id/ifc-link')
  @OrgRoles('OWNER', 'ADMIN')
  async setIfcLink(
    @OrgMember() member: OrgMemberContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeviceIfcLinkInputDto,
  ) {
    const data = await this.service.setIfcLink(member, id, dto.ifcGlobalId ?? null);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
