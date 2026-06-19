import { Controller, Get, Param, ParseUUIDPipe, StreamableFile } from '@nestjs/common';
import { OrgMember } from '../organizations/decorators/org-member.decorator';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { ExportService } from './export.service';

@Controller('v1/buildings')
export class ExportController {
  constructor(private readonly service: ExportService) {}

  // Spec 5: federated IFC2x3 network-discipline export — a downloadable .ifc (F3-scoped; MEMBER may export).
  // StreamableFile sends the raw file (no JSON envelope), matching the building-model file downloads.
  @Get(':propertyId/export/ifc')
  async exportIfc(
    @OrgMember() member: OrgMemberContext,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
  ): Promise<StreamableFile> {
    const { filename, ifc } = await this.service.getBuildingExport(member, propertyId);
    return new StreamableFile(Buffer.from(ifc, 'utf-8'), {
      type: 'application/x-step',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
