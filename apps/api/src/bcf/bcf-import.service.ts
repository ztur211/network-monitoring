import { HttpStatus, Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { OrgMemberContext } from '../organizations/org-context.types';
import { PermissionsService } from '../permissions/permissions.service';
import { PropertiesService } from '../properties/properties.service';
import { DevicesRepository } from '../devices/devices.repository';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { readBcfZip } from './bcf-zip';
import { deriveDeviceLinks } from './device-links';
import { toIfcGuid } from '@nodescope/shared';
import { isPng } from './bcf-utils';

/** BCF import result. */
export interface BcfImportResult {
  /** Number of topics upserted (created or updated). */
  topicsUpserted: number;
}

const BCF_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * BcfImportService — Phase B of Spec 6.
 *
 * Accepts a raw .bcfzip buffer, validates it, upserts BcfTopic rows (keyed by
 * `organizationId + guid`), stores snapshots in object storage, and derives
 * BcfTopicDevice links from viewpoint component IfcGuids.
 */
@Injectable()
export class BcfImportService {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly properties: PropertiesService,
    private readonly devices: DevicesRepository,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Import a .bcfzip archive into the given building.
   *
   * Guards:
   * - BCF_001 (413): archive larger than BCF_MAX_BYTES
   * - F3 permission: assertCanConfigure (OWNER/ADMIN-in-scope only)
   * - BCF_003 (422): malformed ZIP or XML
   * - BCF_002 (422): primary viewpoint has no valid PNG snapshot
   *
   * Behaviour:
   * - Each topic is upserted by `[organizationId, guid]` (idempotent re-import).
   * - Snapshots are stored at `org/<orgId>/bcf/<topicGuid>/<viewpointGuid>.png`.
   * - Device links derived via `toIfcGuid(device.id)` ↔ IfcGuid in viewpoint components.
   * - All DB writes (topic + comments + viewpoints + device links) run in one transaction.
   */
  async importBcfZip(
    member: OrgMemberContext,
    buildingPropertyId: string,
    buffer: Buffer,
  ): Promise<BcfImportResult> {
    // Size guard
    if (buffer.length > BCF_MAX_BYTES) {
      throw new NodeScopeException('BCF_001', 'BCF_FILE_TOO_LARGE', HttpStatus.PAYLOAD_TOO_LARGE);
    }

    // Building must exist in the org before the permission gate (consistent with createTopic).
    const building = await this.properties.findInOrg(member.organizationId, buildingPropertyId);
    if (!building) {
      throw new NodeScopeException('PROP_001', 'Building not found', HttpStatus.NOT_FOUND);
    }

    // F3 permission gate
    await this.permissions.assertCanConfigure(member, buildingPropertyId);

    // Parse ZIP
    let parsed;
    try {
      parsed = await readBcfZip(buffer);
    } catch {
      throw new NodeScopeException('BCF_003', 'MALFORMED_BCF_ZIP', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    // Validate each parsed topic has required fields before touching the DB.
    // A malformed-but-parseable archive must 422 (BCF_003), never 500.
    for (const t of parsed.topics) {
      if (!t.title || typeof t.title !== 'string' || t.title.trim() === '') {
        throw new NodeScopeException('BCF_003', 'Malformed BCF archive', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      if (!t.creationAuthor || typeof t.creationAuthor !== 'string' || t.creationAuthor.trim() === '') {
        throw new NodeScopeException('BCF_003', 'Malformed BCF archive', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      if (!t.creationDate || isNaN(new Date(t.creationDate).getTime())) {
        throw new NodeScopeException('BCF_003', 'Malformed BCF archive', HttpStatus.UNPROCESSABLE_ENTITY);
      }
    }

    const { organizationId } = member;

    // Build deviceGuidMap for the building's subtree
    const subtreeIds = await this.properties.subtreePropertyIds(organizationId, buildingPropertyId);
    const buildingDevices = subtreeIds.length > 0
      ? await this.devices.findAllByOrgId(organizationId, { propertyIdIn: subtreeIds })
      : [];
    const deviceGuidMap = new Map<string, string>(
      buildingDevices.map((d) => [toIfcGuid(d.id), d.id]),
    );

    // Validate snapshots and upload them before the DB transaction
    const snapshotKeys = new Map<string, string>(); // viewpointGuid → storageKey
    for (const topic of parsed.topics) {
      for (const vp of topic.viewpoints) {
        if (vp.isPrimary) {
          if (!vp.snapshotPng || !isPng(vp.snapshotPng)) {
            throw new NodeScopeException('BCF_002', 'MISSING_SNAPSHOT_PNG', HttpStatus.UNPROCESSABLE_ENTITY);
          }
          const key = `org/${organizationId}/bcf/${topic.guid}/${vp.guid}.png`;
          const stream = Readable.from(vp.snapshotPng);
          await this.storage.putObjectStream(key, stream, 'image/png');
          snapshotKeys.set(vp.guid, key);
        }
      }
    }

    // Transactional upsert
    let topicsUpserted = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const topic of parsed.topics) {
        // Upsert topic by [organizationId, guid]
        const upserted = await tx.bcfTopic.upsert({
          where: { organizationId_guid: { organizationId, guid: topic.guid } },
          create: {
            organizationId,
            propertyId: buildingPropertyId,
            guid: topic.guid,
            title: topic.title,
            topicType: topic.topicType ?? null,
            topicStatus: topic.topicStatus ?? null,
            priority: topic.priority ?? null,
            labels: topic.labels,
            creationAuthor: topic.creationAuthor,
            creationDate: new Date(topic.creationDate),
            assignedTo: topic.assignedTo ?? null,
            description: topic.description ?? null,
          },
          update: {
            title: topic.title,
            topicType: topic.topicType ?? null,
            topicStatus: topic.topicStatus ?? null,
            priority: topic.priority ?? null,
            labels: topic.labels,
            assignedTo: topic.assignedTo ?? null,
            description: topic.description ?? null,
            modifiedDate: new Date(),
          },
        });
        topicsUpserted++;

        // Delete and re-insert comments (simplest upsert for ordered list)
        await tx.bcfComment.deleteMany({ where: { topicId: upserted.id } });
        if (topic.comments.length > 0) {
          await tx.bcfComment.createMany({
            data: topic.comments.map((c) => ({
              organizationId,
              topicId: upserted.id,
              guid: c.guid,
              comment: c.comment,
              author: c.author,
              date: new Date(c.date),
              viewpointGuid: c.viewpointGuid ?? null,
            })),
          });
        }

        // Delete and re-insert viewpoints
        await tx.bcfViewpoint.deleteMany({ where: { topicId: upserted.id } });
        for (const vp of topic.viewpoints) {
          await tx.bcfViewpoint.create({
            data: {
              organizationId,
              topicId: upserted.id,
              guid: vp.guid,
              camera: vp.camera as object,
              components: vp.components as object,
              clippingPlanes: vp.clippingPlanes as object[],
              snapshotKey: snapshotKeys.get(vp.guid) ?? null,
              isPrimary: vp.isPrimary,
            },
          });
        }

        // Derive and upsert device links — delete is ALWAYS run so re-import with no
        // matching devices clears stale BcfTopicDevice rows (mirrors comments/viewpoints).
        const allComponents = topic.viewpoints.flatMap((vp) =>
          vp.components.selection.map((g) => ({ ifcGuid: g })),
        );
        const deviceIds = deriveDeviceLinks(allComponents, deviceGuidMap);
        await tx.bcfTopicDevice.deleteMany({ where: { topicId: upserted.id } });
        if (deviceIds.length > 0) {
          await tx.bcfTopicDevice.createMany({
            data: deviceIds.map((deviceId) => ({ topicId: upserted.id, deviceId })),
          });
        }
      }
    });

    return { topicsUpserted };
  }
}
