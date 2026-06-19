import { HttpStatus, Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import {
  BcfTopicDto,
  BcfTopicSummaryDto,
  BcfCommentDto,
  BcfViewpointDto,
  BcfCameraDto,
  BcfComponentsDto,
  CreateBcfTopicDto,
  AddBcfCommentDto,
  PatchBcfTopicDto,
} from '@nodescope/shared';
import {
  BcfComment as BcfCommentRow,
  BcfTopic as BcfTopicRow,
  BcfTopicDevice as BcfTopicDeviceRow,
  BcfViewpoint as BcfViewpointRow,
} from '@prisma/client';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { OrgMemberContext } from '../organizations/org-context.types';
import { PermissionsService } from '../permissions/permissions.service';
import { PropertiesService } from '../properties/properties.service';
import { DevicesRepository } from '../devices/devices.repository';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { deriveDeviceLinks } from './device-links';
import { toIfcGuid } from '../export/ifc-guid';

/** Minimum PNG header (8 bytes): \x89PNG\r\n\x1a\n */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_MAGIC[i]) return false;
  }
  return true;
}

type TopicWithRelations = BcfTopicRow & {
  comments: BcfCommentRow[];
  viewpoints: BcfViewpointRow[];
  devices: BcfTopicDeviceRow[];
};

const TOPIC_INCLUDE = { comments: true, viewpoints: true, devices: true } as const;

/**
 * BcfService — Phase C of Spec 6. Topic/comment CRUD with F3 scope enforcement
 * and optimistic concurrency on topic updates.
 *
 * - Reads (list/get) are open to in-scope members (OWNER bypasses) — out of scope
 *   or missing building/topic surfaces as PROP_001/BCF_004 (404).
 * - Mutations (createTopic/addComment/patchTopic) require OWNER/ADMIN-in-scope via
 *   `assertCanConfigure` (MEMBER → ORG_003, out-of-scope ADMIN → PERM_001).
 * - `patchTopic` is optimistic: a stale `baseVersion` → BCF_005 (409).
 */
@Injectable()
export class BcfService {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly properties: PropertiesService,
    private readonly devices: DevicesRepository,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Reads ─────────────────────────────────────────────────────────────────

  /** List the topics of a building (summaries). F3 read-scoped. */
  async listTopics(member: OrgMemberContext, buildingPropertyId: string): Promise<BcfTopicSummaryDto[]> {
    await this.assertView(member, buildingPropertyId);
    const topics = await this.prisma.bcfTopic.findMany({
      where: { organizationId: member.organizationId, propertyId: buildingPropertyId },
      orderBy: { createdAt: 'desc' },
      include: TOPIC_INCLUDE,
    });
    return topics.map((t) => this.toSummaryDto(t));
  }

  /** Fetch one topic with comments + viewpoints. BCF_004 (404) if absent or out of scope. */
  async getTopic(member: OrgMemberContext, topicId: string): Promise<BcfTopicDto> {
    const topic = await this.loadTopicOr404(member, topicId);
    await this.assertView(member, topic.propertyId);
    return this.toTopicDto(topic);
  }

  // ─── Mutations ───────────────────────────────────────────────────────────────

  /** Author a new topic on a building. F3 mutation-gated; derives device links. */
  async createTopic(
    member: OrgMemberContext,
    buildingPropertyId: string,
    dto: CreateBcfTopicDto,
  ): Promise<BcfTopicDto> {
    // Building must exist (read) before the mutation gate, so a bad id is PROP_001 not a perms leak.
    const building = await this.properties.findInOrg(member.organizationId, buildingPropertyId);
    if (!building) {
      throw new NodeScopeException('PROP_001', 'Building not found', HttpStatus.NOT_FOUND);
    }
    await this.permissions.assertCanConfigure(member, buildingPropertyId);

    const { organizationId } = member;
    const author = member.id;
    const now = new Date();

    // Normalize viewpoints (assign guids; validate any snapshot PNG).
    const viewpoints = (dto.viewpoints ?? []).map((vp, i) => ({
      guid: vp.guid ?? randomUUID(),
      camera: vp.camera,
      components: vp.components,
      clippingPlanes: vp.clippingPlanes ?? [],
      isPrimary: vp.isPrimary ?? i === 0,
      snapshotPng: vp.snapshotPngBase64 ? Buffer.from(vp.snapshotPngBase64, 'base64') : undefined,
    }));

    // Derive device links from every viewpoint's selected component IfcGuids.
    const deviceGuidMap = await this.buildDeviceGuidMap(organizationId, buildingPropertyId);
    const components = viewpoints.flatMap((vp) =>
      (vp.components?.selection ?? []).map((g) => ({ ifcGuid: g })),
    );
    const deviceIds = deriveDeviceLinks(components, deviceGuidMap);

    // Upload snapshots before the DB write (avoid half-written rows on upload failure).
    const snapshotKeys = new Map<string, string>(); // viewpointGuid → storageKey
    const topicGuid = randomUUID();
    for (const vp of viewpoints) {
      if (vp.snapshotPng) {
        if (!isPng(vp.snapshotPng)) {
          throw new NodeScopeException('BCF_002', 'Invalid snapshot PNG', HttpStatus.UNPROCESSABLE_ENTITY);
        }
        const key = `org/${organizationId}/bcf/${topicGuid}/${vp.guid}.png`;
        await this.storage.putObjectStream(key, Readable.from(vp.snapshotPng), 'image/png');
        snapshotKeys.set(vp.guid, key);
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const topic = await tx.bcfTopic.create({
        data: {
          organizationId,
          propertyId: buildingPropertyId,
          guid: topicGuid,
          title: dto.title,
          topicType: dto.topicType ?? null,
          topicStatus: dto.topicStatus ?? null,
          priority: dto.priority ?? null,
          labels: dto.labels ?? [],
          creationAuthor: author,
          creationDate: now,
          assignedTo: dto.assignedTo ?? null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          description: dto.description ?? null,
        },
      });

      for (const vp of viewpoints) {
        await tx.bcfViewpoint.create({
          data: {
            organizationId,
            topicId: topic.id,
            guid: vp.guid,
            camera: vp.camera as object,
            components: vp.components as object,
            clippingPlanes: vp.clippingPlanes as object[],
            snapshotKey: snapshotKeys.get(vp.guid) ?? null,
            isPrimary: vp.isPrimary,
          },
        });
      }

      if (deviceIds.length > 0) {
        await tx.bcfTopicDevice.createMany({
          data: deviceIds.map((deviceId) => ({ topicId: topic.id, deviceId })),
        });
      }

      return tx.bcfTopic.findUniqueOrThrow({ where: { id: topic.id }, include: TOPIC_INCLUDE });
    });

    return this.toTopicDto(created);
  }

  /** Append a comment to a topic. F3 mutation-gated; touches modified author/date. */
  async addComment(
    member: OrgMemberContext,
    topicId: string,
    dto: AddBcfCommentDto,
  ): Promise<BcfTopicDto> {
    const topic = await this.loadTopicOr404(member, topicId);
    await this.permissions.assertCanConfigure(member, topic.propertyId);

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.bcfComment.create({
        data: {
          organizationId: member.organizationId,
          topicId: topic.id,
          guid: randomUUID(),
          comment: dto.comment,
          author: member.id,
          date: now,
          viewpointGuid: dto.viewpointGuid ?? null,
        },
      });
      await tx.bcfTopic.update({
        where: { id: topic.id },
        data: { modifiedAuthor: member.id, modifiedDate: now, version: { increment: 1 } },
      });
      return tx.bcfTopic.findUniqueOrThrow({ where: { id: topic.id }, include: TOPIC_INCLUDE });
    });

    return this.toTopicDto(updated);
  }

  /**
   * Patch a topic's metadata with optimistic concurrency.
   * A stale `baseVersion` → BCF_005 (409). On success the version increments.
   */
  async patchTopic(
    member: OrgMemberContext,
    topicId: string,
    dto: PatchBcfTopicDto,
  ): Promise<BcfTopicDto> {
    const topic = await this.loadTopicOr404(member, topicId);
    await this.permissions.assertCanConfigure(member, topic.propertyId);

    const data: Record<string, unknown> = {
      modifiedAuthor: member.id,
      modifiedDate: new Date(),
      version: { increment: 1 },
    };
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.topicType !== undefined) data.topicType = dto.topicType;
    if (dto.topicStatus !== undefined) data.topicStatus = dto.topicStatus;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.labels !== undefined) data.labels = dto.labels;
    if (dto.assignedTo !== undefined) data.assignedTo = dto.assignedTo;
    if (dto.dueDate !== undefined) data.dueDate = dto.dueDate === null ? null : new Date(dto.dueDate);
    if (dto.description !== undefined) data.description = dto.description;

    const result = await this.prisma.bcfTopic.updateMany({
      where: { id: topic.id, organizationId: member.organizationId, version: dto.baseVersion },
      data,
    });
    if (result.count === 0) {
      throw new NodeScopeException('BCF_005', 'Topic version conflict', HttpStatus.CONFLICT);
    }

    const updated = await this.prisma.bcfTopic.findUniqueOrThrow({
      where: { id: topic.id },
      include: TOPIC_INCLUDE,
    });
    return this.toTopicDto(updated);
  }

  // ─── Internals ───────────────────────────────────────────────────────────────

  /** Map `toIfcGuid(deviceId)` → deviceId for every device in the building's subtree. */
  private async buildDeviceGuidMap(
    organizationId: string,
    buildingPropertyId: string,
  ): Promise<Map<string, string>> {
    const subtreeIds = await this.properties.subtreePropertyIds(organizationId, buildingPropertyId);
    const devices =
      subtreeIds.length > 0
        ? await this.devices.findAllByOrgId(organizationId, { propertyIdIn: subtreeIds })
        : [];
    return new Map(devices.map((d) => [toIfcGuid(d.id), d.id]));
  }

  /** Load a topic (with relations) scoped to the member's org, or BCF_004 (404). */
  private async loadTopicOr404(member: OrgMemberContext, topicId: string): Promise<TopicWithRelations> {
    const topic = await this.prisma.bcfTopic.findFirst({
      where: { id: topicId, organizationId: member.organizationId },
      include: TOPIC_INCLUDE,
    });
    if (!topic) {
      throw new NodeScopeException('BCF_004', 'Topic not found', HttpStatus.NOT_FOUND);
    }
    return topic;
  }

  /** F3 read gate. OWNER bypasses; others must be in scope, else PROP_001 (404). */
  private async assertView(member: OrgMemberContext, buildingPropertyId: string): Promise<void> {
    const building = await this.properties.findInOrg(member.organizationId, buildingPropertyId);
    if (!building) {
      throw new NodeScopeException('PROP_001', 'Building not found', HttpStatus.NOT_FOUND);
    }
    if (
      member.role !== 'OWNER' &&
      !(await this.permissions.inScope(member.organizationId, member.id, buildingPropertyId))
    ) {
      throw new NodeScopeException('PROP_001', 'Building not found', HttpStatus.NOT_FOUND);
    }
  }

  // ─── DTO mappers ─────────────────────────────────────────────────────────────

  private toSummaryDto(t: TopicWithRelations): BcfTopicSummaryDto {
    return {
      id: t.id,
      organizationId: t.organizationId,
      propertyId: t.propertyId,
      guid: t.guid,
      title: t.title,
      topicType: t.topicType,
      topicStatus: t.topicStatus,
      priority: t.priority,
      labels: t.labels,
      creationAuthor: t.creationAuthor,
      creationDate: t.creationDate.toISOString(),
      modifiedAuthor: t.modifiedAuthor,
      modifiedDate: t.modifiedDate ? t.modifiedDate.toISOString() : null,
      assignedTo: t.assignedTo,
      dueDate: t.dueDate ? t.dueDate.toISOString() : null,
      description: t.description,
      version: t.version,
      commentCount: t.comments.length,
      deviceIds: t.devices.map((d) => d.deviceId),
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  private toTopicDto(t: TopicWithRelations): BcfTopicDto {
    return {
      ...this.toSummaryDto(t),
      comments: t.comments.map((c) => this.toCommentDto(c)),
      viewpoints: t.viewpoints.map((v) => this.toViewpointDto(v)),
    };
  }

  private toCommentDto(c: BcfCommentRow): BcfCommentDto {
    return {
      id: c.id,
      guid: c.guid,
      comment: c.comment,
      author: c.author,
      date: c.date.toISOString(),
      viewpointGuid: c.viewpointGuid ?? null,
    };
  }

  private toViewpointDto(v: BcfViewpointRow): BcfViewpointDto {
    return {
      id: v.id,
      guid: v.guid,
      camera: v.camera as unknown as BcfCameraDto,
      components: v.components as unknown as BcfComponentsDto,
      clippingPlanes: (v.clippingPlanes as unknown[]) ?? [],
      isPrimary: v.isPrimary,
      hasSnapshot: v.snapshotKey != null,
    };
  }
}
