import { mapLimitResults } from '@nodescope/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { OrgMemberContext } from '../organizations/org-context.types';
import { PermissionsService } from '../permissions/permissions.service';
import { PropertiesService } from '../properties/properties.service';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { writeBcfZip, BcfCamera, BcfComponents, ParsedComment, ParsedTopic, ParsedViewpoint } from './bcf-zip';

/** Collect a Readable stream into a single Buffer. */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * BcfExportService — Phase C of Spec 6.
 *
 * Reconstructs every topic of a building from the DB (markup + viewpoints +
 * comments) plus its snapshot bytes from object storage, then serializes them
 * into a single BCF 2.1 `.bcfzip` buffer via the shared codec.
 *
 * Read access is F3-scoped: OWNER bypasses; any other member must have the
 * building's propertyId in their effective scope, else PROP_001 (404, building
 * "not found" from the caller's perspective).
 */
@Injectable()
export class BcfExportService {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly properties: PropertiesService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Export all BCF topics of the given building as a `.bcfzip` buffer.
   *
   * Guards:
   * - PROP_001 (404): building does not exist, or the member is out of scope.
   */
  async exportBcf(member: OrgMemberContext, buildingPropertyId: string): Promise<Buffer> {
    await this.assertView(member, buildingPropertyId);

    const topics = await this.prisma.bcfTopic.findMany({
      where: { organizationId: member.organizationId, propertyId: buildingPropertyId },
      orderBy: { createdAt: 'asc' },
      include: {
        comments: true,
        viewpoints: true,
      },
    });

    // Pre-fetch every viewpoint snapshot from object storage with bounded concurrency.
    // This was a serial nested loop — one blocking round-trip per snapshot before the zip
    // could be written (e.g. 50 topics x 3 snapshots = 150 sequential fetches).
    const snapshotKeys = [
      ...new Set(
        topics.flatMap((t) => t.viewpoints.map((vp) => vp.snapshotKey).filter((k): k is string => k != null)),
      ),
    ];
    const snapshots = new Map<string, Buffer>(
      await mapLimitResults(
        snapshotKeys,
        8,
        async (key) => [key, await streamToBuffer(await this.storage.getObjectStream(key))] as const,
      ),
    );

    const parsedTopics: ParsedTopic[] = [];
    for (const topic of topics) {
      const viewpoints: ParsedViewpoint[] = [];
      for (const vp of topic.viewpoints) {
        const snapshotPng = vp.snapshotKey ? snapshots.get(vp.snapshotKey) : undefined;
        viewpoints.push({
          guid: vp.guid,
          isPrimary: vp.isPrimary,
          camera: vp.camera as unknown as BcfCamera,
          components: vp.components as unknown as BcfComponents,
          clippingPlanes: (vp.clippingPlanes as unknown[]) ?? [],
          snapshotPng,
        });
      }
      // Primary viewpoint(s) first so writeBcfZip's `viewpoints[0]` is the primary.
      viewpoints.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));

      const comments: ParsedComment[] = topic.comments.map((c) => ({
        guid: c.guid,
        comment: c.comment,
        author: c.author,
        date: c.date.toISOString(),
        viewpointGuid: c.viewpointGuid ?? undefined,
      }));

      parsedTopics.push({
        guid: topic.guid,
        title: topic.title,
        topicType: topic.topicType ?? undefined,
        topicStatus: topic.topicStatus ?? undefined,
        priority: topic.priority ?? undefined,
        labels: topic.labels,
        creationAuthor: topic.creationAuthor,
        creationDate: topic.creationDate.toISOString(),
        assignedTo: topic.assignedTo ?? undefined,
        description: topic.description ?? undefined,
        comments,
        viewpoints,
      });
    }

    return writeBcfZip(parsedTopics);
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
}
