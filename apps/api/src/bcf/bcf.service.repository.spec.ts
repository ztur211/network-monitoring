/**
 * Integration test for BcfService (topic/comment CRUD).
 *
 * Named `*.repository.spec.ts` so it runs under jest.integration.config.ts.
 * Real test DB + real DevicesRepository; mocks StorageService (MinIO not running),
 * PermissionsService (OWNER always passes), and PropertiesService (findInOrg +
 * subtreePropertyIds backed by closures over the seeded ids). Topics are created
 * WITHOUT snapshots, so storage is never exercised.
 *
 * Covers:
 *  1. createTopic with a viewpoint selecting toIfcGuid(deviceId) → deviceIds == [deviceId]
 *  2. addComment → comment persisted, version bumped
 *  3. patchTopic (status + baseVersion) → version increments
 *  4. patchTopic with stale baseVersion → BCF_005
 *  5. listTopics → returns the created topic summary
 *  6. getTopic on a missing id → BCF_004
 */
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { BcfService } from './bcf.service';
import { StorageService } from '../storage/storage.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PropertiesService } from '../properties/properties.service';
import { DevicesRepository } from '../devices/devices.repository';
import { DeviceCategory } from '@prisma/client';
import { toIfcGuid } from '@nodescope/shared';
import type { CreateBcfTopicDto } from '@nodescope/shared';
import type { OrgMemberContext } from '../organizations/org-context.types';

describe('BcfService (integration)', () => {
  let service: BcfService;
  let prisma: PrismaService;
  let orgId: string;
  let buildingId: string;
  let deviceId: string;

  let subtreeIds: string[] = [];
  const putObjectStream = jest.fn().mockResolvedValue(undefined);
  const assertCanConfigure = jest.fn().mockResolvedValue(undefined);
  const inScope = jest.fn().mockResolvedValue(true);
  const findInOrg = jest.fn();
  const subtreePropertyIds = jest.fn().mockImplementation(() => Promise.resolve(subtreeIds));

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      providers: [
        BcfService,
        PrismaService,
        DevicesRepository,
        { provide: StorageService, useValue: { putObjectStream } },
        { provide: PermissionsService, useValue: { assertCanConfigure, inScope } },
        { provide: PropertiesService, useValue: { findInOrg, subtreePropertyIds } },
      ],
    }).compile();

    service = ref.get(BcfService);
    prisma = ref.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    assertCanConfigure.mockResolvedValue(undefined);
    inScope.mockResolvedValue(true);
    subtreeIds = [];

    const org = await prisma.organization.create({
      data: { name: `BcfSvc${Date.now()}${Math.floor(performance.now())}` },
    });
    orgId = org.id;

    const site = await prisma.property.create({
      data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'Site' },
    });
    const building = await prisma.property.create({
      data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'Bldg' },
    });
    buildingId = building.id;
    subtreeIds = [buildingId];
    findInOrg.mockResolvedValue({ id: buildingId, organizationId: orgId, type: 'BUILDING' });

    const user = await prisma.user.create({
      data: { email: `bcf-svc-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`, emailVerified: false },
    });
    const network = await prisma.network.create({
      data: { organizationId: orgId, userId: user.id, name: 'Net' },
    });
    await prisma.networkProperty.create({
      data: { organizationId: orgId, networkId: network.id, propertyId: buildingId },
    });
    const device = await prisma.device.create({
      data: {
        organizationId: orgId,
        userId: user.id,
        networkId: network.id,
        propertyId: buildingId,
        name: 'Switch-1',
        category: DeviceCategory.SWITCH,
      },
    });
    deviceId = device.id;
  });

  afterEach(async () => {
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  });

  const owner = (): OrgMemberContext => ({ id: 'mem-owner', organizationId: orgId, role: 'OWNER' });

  function topicDto(): CreateBcfTopicDto {
    return {
      title: 'Loose cable',
      topicType: 'Issue',
      topicStatus: 'Open',
      priority: 'High',
      labels: ['cabling'],
      viewpoints: [
        {
          camera: { kind: 'perspective', position: [0, 0, 10], direction: [0, 0, -1], up: [0, 1, 0], fieldOfView: 60 },
          components: { selection: [toIfcGuid(deviceId)], visibility: { defaultVisibility: true, exceptions: [] } },
          isPrimary: true,
        },
      ],
    };
  }

  it('createTopic derives device links from a viewpoint selecting toIfcGuid(deviceId)', async () => {
    const created = await service.createTopic(owner(), buildingId, topicDto());

    expect(created.title).toBe('Loose cable');
    expect(created.propertyId).toBe(buildingId);
    expect(created.version).toBe(1);
    expect(created.creationAuthor).toBe('mem-owner');
    expect(created.viewpoints).toHaveLength(1);
    expect(created.viewpoints[0].hasSnapshot).toBe(false);
    expect(created.deviceIds).toEqual([deviceId]);

    // Persisted link verified directly.
    const links = await prisma.bcfTopicDevice.findMany({ where: { topicId: created.id } });
    expect(links.map((l) => l.deviceId)).toEqual([deviceId]);
    // No snapshot supplied → storage untouched.
    expect(putObjectStream).not.toHaveBeenCalled();
  });

  it('addComment persists a comment and bumps the topic version', async () => {
    const created = await service.createTopic(owner(), buildingId, topicDto());
    const updated = await service.addComment(owner(), created.id, { comment: 'Please fix' });

    expect(updated.comments).toHaveLength(1);
    expect(updated.comments[0].comment).toBe('Please fix');
    expect(updated.comments[0].author).toBe('mem-owner');
    expect(updated.commentCount).toBe(1);
    expect(updated.version).toBe(created.version + 1);
    expect(updated.modifiedAuthor).toBe('mem-owner');
  });

  it('patchTopic with the current baseVersion updates status and increments version', async () => {
    const created = await service.createTopic(owner(), buildingId, topicDto());
    const patched = await service.patchTopic(owner(), created.id, {
      topicStatus: 'Closed',
      baseVersion: created.version,
    });

    expect(patched.topicStatus).toBe('Closed');
    expect(patched.version).toBe(created.version + 1);
  });

  it('patchTopic with a stale baseVersion → BCF_005 (409)', async () => {
    const created = await service.createTopic(owner(), buildingId, topicDto());
    // Advance the version once.
    await service.patchTopic(owner(), created.id, { topicStatus: 'InProgress', baseVersion: created.version });
    // Reuse the now-stale base version.
    await expect(
      service.patchTopic(owner(), created.id, { topicStatus: 'Closed', baseVersion: created.version }),
    ).rejects.toMatchObject({ code: 'BCF_005' });
  });

  it('listTopics returns the created topic summary', async () => {
    const created = await service.createTopic(owner(), buildingId, topicDto());
    const list = await service.listTopics(owner(), buildingId);

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
    expect(list[0].title).toBe('Loose cable');
    expect(list[0].deviceIds).toEqual([deviceId]);
    // Summary has no nested arrays.
    expect((list[0] as unknown as Record<string, unknown>).comments).toBeUndefined();
    expect((list[0] as unknown as Record<string, unknown>).viewpoints).toBeUndefined();
  });

  it('getTopic on a missing id → BCF_004 (404)', async () => {
    await expect(
      service.getTopic(owner(), '00000000-0000-0000-0000-0000000000ff'),
    ).rejects.toMatchObject({ code: 'BCF_004' });
  });
});
