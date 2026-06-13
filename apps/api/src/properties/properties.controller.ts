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
import { OrgRoles } from '../organizations/decorators/org-roles.decorator';
import { OrgId } from '../organizations/decorators/org-id.decorator';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto, PatchPropertyDto } from './properties.dto';

@Controller('v1/properties')
@UseGuards(OrgRoleGuard)
export class PropertiesController {
  constructor(private readonly service: PropertiesService) {}

  @Get()
  async list(@OrgId() orgId: string) {
    return { success: true, data: await this.service.listProperties(orgId), timestamp: new Date().toISOString() };
  }

  @Get(':id')
  async get(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return { success: true, data: await this.service.getProperty(orgId, id), timestamp: new Date().toISOString() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @OrgRoles('OWNER', 'ADMIN')
  async create(@OrgId() orgId: string, @Body() dto: CreatePropertyDto) {
    return { success: true, data: await this.service.createProperty(orgId, dto), timestamp: new Date().toISOString() };
  }

  @Patch(':id')
  @OrgRoles('OWNER', 'ADMIN')
  async update(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() patch: PatchPropertyDto) {
    return { success: true, data: await this.service.updateProperty(orgId, id, patch), timestamp: new Date().toISOString() };
  }

  @Delete(':id')
  @OrgRoles('OWNER', 'ADMIN')
  async remove(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteProperty(orgId, id);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
