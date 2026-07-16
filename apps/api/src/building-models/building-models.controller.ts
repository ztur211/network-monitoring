import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { OrgMember } from '../organizations/decorators/org-member.decorator';
import { OrgRoles } from '../organizations/decorators/org-roles.decorator';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { BuildingModelsService } from './building-models.service';
import { ActivateVersionDto } from './building-models.dto';
import { bindStreamToResponse } from './stream-lifecycle';

const envelope = (data: unknown) => ({ success: true, data, timestamp: new Date().toISOString() });

@Controller('v1/buildings/:propertyId/model')
export class BuildingModelsController {
  constructor(private readonly service: BuildingModelsService) {}

  @Get()
  async getModel(@OrgMember() member: OrgMemberContext, @Param('propertyId', ParseUUIDPipe) propertyId: string) {
    return envelope(await this.service.getModel(member, propertyId));
  }

  @Get('versions')
  async listVersions(@OrgMember() member: OrgMemberContext, @Param('propertyId', ParseUUIDPipe) propertyId: string) {
    return envelope(await this.service.listVersions(member, propertyId));
  }

  // Client sends the IFC as the raw request body (Content-Type: application/octet-stream),
  // which the default JSON/urlencoded body parsers ignore — so `req` is the unconsumed stream.
  @Post('versions')
  @OrgRoles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @OrgMember() member: OrgMemberContext,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('fileName') fileName: string,
    @Query('units') units: string | undefined,
    @Req() req: Request,
  ) {
    return envelope(await this.service.uploadVersion(member, propertyId, fileName, units ?? null, req));
  }

  @Put('active')
  @OrgRoles('OWNER', 'ADMIN')
  async activate(
    @OrgMember() member: OrgMemberContext,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: ActivateVersionDto,
  ) {
    return envelope(await this.service.activateVersion(member, propertyId, dto.versionId));
  }

  @Delete('versions/:versionId')
  @OrgRoles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteVersion(
    @OrgMember() member: OrgMemberContext,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    await this.service.deleteVersion(member, propertyId, versionId);
  }

  @Get('active/file')
  async downloadActive(
    @OrgMember() member: OrgMemberContext,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { stream, fileName, sizeBytes } = await this.service.getActiveFile(member, propertyId);
    bindStreamToResponse(stream, response);
    return new StreamableFile(stream, {
      type: 'application/octet-stream',
      disposition: `attachment; filename="${fileName}"`,
      length: sizeBytes,
    });
  }

  @Get('versions/:versionId/file')
  async downloadVersion(
    @OrgMember() member: OrgMemberContext,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { stream, fileName, sizeBytes } = await this.service.getVersionFile(member, propertyId, versionId);
    bindStreamToResponse(stream, response);
    return new StreamableFile(stream, {
      type: 'application/octet-stream',
      disposition: `attachment; filename="${fileName}"`,
      length: sizeBytes,
    });
  }
}
