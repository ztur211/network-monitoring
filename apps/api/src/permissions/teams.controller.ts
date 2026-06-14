import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { OrgMember } from '../organizations/decorators/org-member.decorator';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { CreateTeamDto, UpdateTeamDto } from './permissions.dto';
import { PermissionsService } from './permissions.service';

@Controller('v1/teams')
export class TeamsController {
  constructor(private readonly service: PermissionsService) {}

  @Get()
  async list(@OrgMember() member: OrgMemberContext) {
    return { success: true, data: await this.service.listTeams(member), timestamp: new Date().toISOString() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@OrgMember() member: OrgMemberContext, @Body() dto: CreateTeamDto) {
    return { success: true, data: await this.service.createTeamFor(member, dto), timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  async rename(@OrgMember() member: OrgMemberContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTeamDto) {
    return { success: true, data: await this.service.renameTeamFor(member, id, dto.baseVersion, dto.name), timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@OrgMember() member: OrgMemberContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteTeamFor(member, id);
  }
}
