import { HttpStatus, Injectable, Inject } from '@nestjs/common';
import { WS_EVENTS } from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { OrgMemberContext } from '../organizations/org-context.types';
import { AuditService } from '../audit/audit.service';
import { IRealtimeService, REALTIME_SERVICE } from '../realtime/realtime.types';
import { PropertiesService } from '../properties/properties.service';
import { StorageService } from '../storage/storage.service';
import { BuildingModelsRepository } from './building-models.repository';
import { toBuildingModelDto, toVersionDto } from './building-models.mapper';

/**
 * Orchestrates building-model reads, activation/rollback, and version deletion over
 * the Phase A repository + storage seam. Mutations are OWNER/ADMIN-gated at the
 * controller (`@OrgRoles`); audit + `v1:buildingModel:*` org-room events ride here.
 * Upload (Task 3) + download (Task 4) extend this service.
 */
@Injectable()
export class BuildingModelsService {
  constructor(
    private readonly repo: BuildingModelsRepository,
    private readonly storage: StorageService,
    private readonly properties: PropertiesService,
    private readonly audit: AuditService,
    @Inject(REALTIME_SERVICE) private readonly realtime: IRealtimeService,
  ) {}

  private async loadModelOr404(member: OrgMemberContext, propertyId: string) {
    const model = await this.repo.findByProperty(member.organizationId, propertyId);
    if (!model) throw new NodeScopeException('MODEL_001', 'BUILDING_MODEL_NOT_FOUND', HttpStatus.NOT_FOUND);
    return model;
  }

  async getModel(member: OrgMemberContext, propertyId: string) {
    return toBuildingModelDto(await this.loadModelOr404(member, propertyId));
  }

  async listVersions(member: OrgMemberContext, propertyId: string) {
    const model = await this.loadModelOr404(member, propertyId);
    return (await this.repo.listVersions(member.organizationId, model.id)).map(toVersionDto);
  }

  async activateVersion(member: OrgMemberContext, propertyId: string, versionId: string) {
    const model = await this.loadModelOr404(member, propertyId);
    const version = await this.repo.findVersion(member.organizationId, versionId);
    if (!version || version.buildingModelId !== model.id) {
      throw new NodeScopeException('MODEL_004', 'MODEL_VERSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    const ok = await this.repo.setActiveVersion(member.organizationId, model.id, versionId, model.version);
    if (!ok) throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);
    this.realtime.pushToOrg(member.organizationId, WS_EVENTS.BUILDING_MODEL_ACTIVATED, { propertyId, versionId });
    return toBuildingModelDto(await this.loadModelOr404(member, propertyId));
  }

  async deleteVersion(member: OrgMemberContext, propertyId: string, versionId: string): Promise<void> {
    const model = await this.loadModelOr404(member, propertyId);
    const version = await this.repo.findVersion(member.organizationId, versionId);
    if (!version || version.buildingModelId !== model.id) {
      throw new NodeScopeException('MODEL_004', 'MODEL_VERSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    if (model.activeVersionId === versionId) {
      throw new NodeScopeException('MODEL_005', 'CANNOT_DELETE_ACTIVE_VERSION', HttpStatus.CONFLICT);
    }
    await this.repo.deleteVersion(member.organizationId, versionId);
    await this.storage.deleteObject(version.storageKey);
    await this.audit.recordDelete(member.organizationId, 'BuildingModelVersion', version);
    this.realtime.pushToOrg(member.organizationId, WS_EVENTS.BUILDING_MODEL_DELETED, { versionId });
  }
}
