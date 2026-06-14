import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { OrgRoleGuard } from '../organizations/guards/org-role.guard';
import { OrgMember } from '../organizations/decorators/org-member.decorator';
import { OrgMemberContext } from '../organizations/org-context.types';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto, PatchPropertyDto } from './properties.dto';

@Controller('v1/properties')
@UseGuards(OrgRoleGuard)
export class PropertiesController {
  constructor(private readonly service: PropertiesService) {}

  @Get()
  async list(@OrgMember() member: OrgMemberContext) {
    return { success: true, data: await this.service.listProperties(member), timestamp: new Date().toISOString() };
  }

  @Get(':id')
  async get(@OrgMember() member: OrgMemberContext, @Param('id', ParseUUIDPipe) id: string) {
    return { success: true, data: await this.service.getProperty(member, id), timestamp: new Date().toISOString() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@OrgMember() member: OrgMemberContext, @Body() dto: CreatePropertyDto) {
    return { success: true, data: await this.service.createProperty(member, dto), timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  async update(@OrgMember() member: OrgMemberContext, @Param('id', ParseUUIDPipe) id: string, @Body() patch: PatchPropertyDto) {
    return { success: true, data: await this.service.updateProperty(member, id, patch), timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  async remove(@OrgMember() member: OrgMemberContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteProperty(member, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
