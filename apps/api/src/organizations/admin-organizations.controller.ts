import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RequireSuperAdmin } from './decorators/require-super-admin.decorator';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto, AddDomainDto, DesignateOwnerDto } from './organizations.dto';

@Controller('v1/admin/organizations')
@UseGuards(AuthGuard)
@RequireSuperAdmin()
export class AdminOrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateOrganizationDto) {
    return { success: true, data: await this.service.provisionOrganization(dto), timestamp: new Date().toISOString() };
  }

  @Post(':id/domains')
  @HttpCode(HttpStatus.CREATED)
  async addDomain(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddDomainDto) {
    await this.service.addDomain(id, dto.domain);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }

  @Post(':id/owner')
  @HttpCode(HttpStatus.CREATED)
  async designateOwner(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DesignateOwnerDto) {
    return { success: true, data: await this.service.designateOwner(id, dto.email), timestamp: new Date().toISOString() };
  }
}
