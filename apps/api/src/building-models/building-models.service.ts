import { HttpStatus, Injectable, Inject } from '@nestjs/common';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { WS_EVENTS, BuildingModelVersionDto } from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { meteredHashingStream, UploadTooLargeError, InvalidIfcError } from './metered-hashing-stream';
import { OrgMemberContext } from '../organizations/org-context.types';
import { AuditService } from '../audit/audit.service';
import { IRealtimeService, REALTIME_SERVICE } from '../realtime/realtime.types';
import { PermissionsService } from '../permissions/permissions.service';
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
    private readonly permissions: PermissionsService,
    @Inject(REALTIME_SERVICE) private readonly realtime: IRealtimeService,
  ) {}

  private async loadModelOr404(member: OrgMemberContext, propertyId: string) {
    const model = await this.repo.findByProperty(member.organizationId, propertyId);
    if (!model) throw new NodeScopeException('MODEL_001', 'BUILDING_MODEL_NOT_FOUND', HttpStatus.NOT_FOUND);
    return model;
  }

  /**
   * F3 read gate. OWNER sees every building; otherwise the building (its own propertyId is the
   * governing site) must be in the member's assigned scope. Out-of-scope reads 404 (not 403) so a
   * model's existence is not revealed outside scope — mirrors the read-isolation other modules apply.
   */
  private async assertReadable(member: OrgMemberContext, propertyId: string): Promise<void> {
    if (member.role === 'OWNER') return;
    if (!(await this.permissions.inScope(member.organizationId, member.id, propertyId))) {
      throw new NodeScopeException('MODEL_001', 'BUILDING_MODEL_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
  }

  async getModel(member: OrgMemberContext, propertyId: string) {
    await this.assertReadable(member, propertyId);
    return toBuildingModelDto(await this.loadModelOr404(member, propertyId));
  }

  async listVersions(member: OrgMemberContext, propertyId: string) {
    await this.assertReadable(member, propertyId);
    const model = await this.loadModelOr404(member, propertyId);
    return (await this.repo.listVersions(member.organizationId, model.id)).map(toVersionDto);
  }

  async activateVersion(member: OrgMemberContext, propertyId: string, versionId: string) {
    await this.permissions.assertCanConfigure(member, propertyId);
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
    await this.permissions.assertCanConfigure(member, propertyId);
    const model = await this.loadModelOr404(member, propertyId);
    const version = await this.repo.findVersion(member.organizationId, versionId);
    if (!version || version.buildingModelId !== model.id) {
      throw new NodeScopeException('MODEL_004', 'MODEL_VERSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    if (model.activeVersionId === versionId) {
      throw new NodeScopeException('MODEL_005', 'CANNOT_DELETE_ACTIVE_VERSION', HttpStatus.CONFLICT);
    }
    await this.storage.deleteObject(version.storageKey);
    await this.repo.deleteVersion(member.organizationId, versionId);
    await this.audit.recordDelete(member.organizationId, 'BuildingModelVersion', version);
    this.realtime.pushToOrg(member.organizationId, WS_EVENTS.BUILDING_MODEL_DELETED, { versionId });
  }

  async getActiveFile(member: OrgMemberContext, propertyId: string): Promise<{ stream: Readable; fileName: string; sizeBytes: number }> {
    await this.assertReadable(member, propertyId);
    const model = await this.loadModelOr404(member, propertyId);
    if (!model.activeVersionId) {
      throw new NodeScopeException('MODEL_004', 'MODEL_VERSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    const version = await this.repo.findVersion(member.organizationId, model.activeVersionId);
    if (!version) throw new NodeScopeException('MODEL_004', 'MODEL_VERSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    return { stream: await this.storage.getObjectStream(version.storageKey), fileName: version.fileName, sizeBytes: version.sizeBytes };
  }

  async getVersionFile(
    member: OrgMemberContext,
    propertyId: string,
    versionId: string,
  ): Promise<{ stream: Readable; fileName: string; sizeBytes: number }> {
    await this.assertReadable(member, propertyId);
    const model = await this.loadModelOr404(member, propertyId);
    const version = await this.repo.findVersion(member.organizationId, versionId);
    if (!version || version.buildingModelId !== model.id) {
      throw new NodeScopeException('MODEL_004', 'MODEL_VERSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return { stream: await this.storage.getObjectStream(version.storageKey), fileName: version.fileName, sizeBytes: version.sizeBytes };
  }

  /**
   * Proxied streaming upload: pipe the raw request body through the metered/hashing
   * transform into the bucket, then (only after the object lands — §11 orphan
   * mitigation) write the immutable version row and flip the active pointer.
   */
  async uploadVersion(
    member: OrgMemberContext,
    propertyId: string,
    fileName: string,
    units: string | null,
    body: Readable,
  ): Promise<BuildingModelVersionDto> {
    // F3 per-site configure scope FIRST — OWNER any; out-of-scope ADMIN → PERM_001; MEMBER → ORG_003
    // (the controller's @OrgRoles already blocks MEMBER, this adds the per-site authority). Gating
    // before any DB lookup means an out-of-scope ADMIN learns nothing about the target property's
    // existence/type, and never triggers the (expensive) streamed upload. Mirrors activate/delete.
    await this.permissions.assertCanConfigure(member, propertyId);

    const property = await this.properties.findInOrg(member.organizationId, propertyId);
    if (!property) throw new NodeScopeException('MODEL_001', 'BUILDING_MODEL_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (property.type !== 'BUILDING') {
      throw new NodeScopeException('MODEL_002', 'PROPERTY_NOT_BUILDING', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const versionId = randomUUID();
    const key = this.storage.buildVersionKey(member.organizationId, propertyId, versionId);
    const maxBytes = parseInt(process.env.MODEL_MAX_BYTES ?? '209715200', 10);
    const { transform, result } = meteredHashingStream(maxBytes);
    // Capture the transform's validation error directly — the AWS Upload may wrap it.
    let streamError: Error | undefined;
    transform.on('error', (e: Error) => {
      streamError = e;
    });
    try {
      // pipeline propagates request abort/error into the transform. Run the storage consumer at
      // the same time so backpressure works and both promises settle on either-side failure.
      await Promise.all([
        pipeline(body, transform),
        this.storage.putObjectStream(key, transform, 'application/octet-stream'),
      ]);
    } catch (e) {
      await this.storage.deleteObject(key).catch(() => undefined); // clean any partial object
      const err = streamError ?? e;
      if (err instanceof UploadTooLargeError) {
        throw new NodeScopeException('MODEL_006', 'MODEL_FILE_TOO_LARGE', HttpStatus.PAYLOAD_TOO_LARGE);
      }
      if (err instanceof InvalidIfcError) {
        throw new NodeScopeException('MODEL_007', 'INVALID_IFC_FILE', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      throw e;
    }
    const { contentHash, sizeBytes } = result();

    // Get-or-create the model only AFTER the object has landed — a failed upload
    // leaves no empty model. Name defaults to the building's name on first upload.
    let model;
    let versionNumber: number;
    let version;
    try {
      model =
        (await this.repo.findByProperty(member.organizationId, propertyId)) ??
        (await this.repo.createModel({ organizationId: member.organizationId, propertyId, name: property.name }));
      versionNumber = await this.repo.nextVersionNumber(member.organizationId, model.id);
      version = await this.repo.createVersion({
        organizationId: member.organizationId,
        buildingModelId: model.id,
        versionNumber,
        storageKey: key,
        fileName: fileName || 'model.ifc',
        contentHash,
        sizeBytes,
        units,
        uploadedByMemberId: member.id,
      });
    } catch (error) {
      // Until createVersion succeeds no DB row owns the landed blob.
      await this.storage.deleteObject(key).catch(() => undefined);
      throw error;
    }
    await this.repo.setActiveVersion(member.organizationId, model.id, version.id, model.version);
    await this.audit.recordCreate(member.organizationId, 'BuildingModelVersion', version);
    this.realtime.pushToOrg(member.organizationId, WS_EVENTS.BUILDING_MODEL_VERSION_UPLOADED, {
      propertyId,
      versionId: version.id,
      versionNumber,
    });
    return toVersionDto(version);
  }
}
