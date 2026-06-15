import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { OrgMember } from '../organizations/decorators/org-member.decorator';
import { OrgRoles } from '../organizations/decorators/org-roles.decorator';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { SpatialService } from './spatial.service';
import { DevicePositionInputDto } from './spatial.dto';

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
}
