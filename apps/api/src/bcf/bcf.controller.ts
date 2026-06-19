import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OrgMember } from '../organizations/decorators/org-member.decorator';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { BcfService } from './bcf.service';
import { BcfImportService } from './bcf-import.service';
import { BcfExportService } from './bcf-export.service';
import { CreateBcfTopicDto, AddBcfCommentDto, PatchBcfTopicDto } from '@nodescope/shared';

/**
 * BCF HTTP layer — Spec 6 Phase C Task 4.
 *
 * Routes (all under @Controller('v1')):
 *   POST  buildings/:propertyId/bcf/import   — import .bcfzip multipart (OWNER/ADMIN-in-scope)
 *   GET   buildings/:propertyId/bcf/export   — export .bcfzip raw download (F3 read-scoped)
 *   GET   buildings/:propertyId/bcf/topics   — list topic summaries (F3 read-scoped)
 *   GET   bcf/topics/:id                     — get single topic (F3 read-scoped)
 *   POST  buildings/:propertyId/bcf/topics   — create topic (OWNER/ADMIN-in-scope)
 *   PATCH bcf/topics/:id                     — patch topic metadata (OWNER/ADMIN-in-scope)
 *   POST  bcf/topics/:id/comments            — append comment (OWNER/ADMIN-in-scope)
 *
 * No @OrgRoles on any route — permission is enforced by the services themselves
 * (assertCanConfigure → ORG_003 for MEMBER; PERM_001 for out-of-scope ADMIN).
 * Reads use assertView → PROP_001 (404) for out-of-scope members.
 *
 * Export sends a raw .bcfzip via StreamableFile (no JSON envelope).
 * All other routes return the standard { success, data, timestamp } envelope
 * (there is no global response interceptor).
 */
@Controller('v1')
export class BcfController {
  constructor(
    private readonly bcf: BcfService,
    private readonly importSvc: BcfImportService,
    private readonly exportSvc: BcfExportService,
  ) {}

  // ─── Import ───────────────────────────────────────────────────────────────

  @Post('buildings/:propertyId/bcf/import')
  @UseInterceptors(FileInterceptor('file'))
  async import(
    @OrgMember() m: OrgMemberContext,
    @Param('propertyId') propertyId: string,
    @UploadedFile() file: { buffer: Buffer },
  ) {
    const data = await this.importSvc.importBcfZip(m, propertyId, file.buffer);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  // ─── Export ───────────────────────────────────────────────────────────────

  @Get('buildings/:propertyId/bcf/export')
  async export(
    @OrgMember() m: OrgMemberContext,
    @Param('propertyId') propertyId: string,
  ): Promise<StreamableFile> {
    const buf = await this.exportSvc.exportBcf(m, propertyId);
    return new StreamableFile(buf, {
      type: 'application/octet-stream',
      disposition: `attachment; filename="${propertyId}-issues.bcfzip"`,
    });
  }

  // ─── List topics ──────────────────────────────────────────────────────────

  @Get('buildings/:propertyId/bcf/topics')
  async listTopics(
    @OrgMember() m: OrgMemberContext,
    @Param('propertyId') propertyId: string,
  ) {
    const data = await this.bcf.listTopics(m, propertyId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  // ─── Get single topic ─────────────────────────────────────────────────────

  @Get('bcf/topics/:id')
  async getTopic(
    @OrgMember() m: OrgMemberContext,
    @Param('id') id: string,
  ) {
    const data = await this.bcf.getTopic(m, id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  // ─── Create topic ─────────────────────────────────────────────────────────

  @Post('buildings/:propertyId/bcf/topics')
  @HttpCode(201)
  async createTopic(
    @OrgMember() m: OrgMemberContext,
    @Param('propertyId') propertyId: string,
    @Body() dto: CreateBcfTopicDto,
  ) {
    const data = await this.bcf.createTopic(m, propertyId, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  // ─── Patch topic ──────────────────────────────────────────────────────────

  @Patch('bcf/topics/:id')
  async patchTopic(
    @OrgMember() m: OrgMemberContext,
    @Param('id') id: string,
    @Body() dto: PatchBcfTopicDto,
  ) {
    const data = await this.bcf.patchTopic(m, id, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  // ─── Add comment ──────────────────────────────────────────────────────────

  @Post('bcf/topics/:id/comments')
  @HttpCode(201)
  async addComment(
    @OrgMember() m: OrgMemberContext,
    @Param('id') id: string,
    @Body() dto: AddBcfCommentDto,
  ) {
    const data = await this.bcf.addComment(m, id, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
