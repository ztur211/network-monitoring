/**
 * Integration test for BcfImportService.
 *
 * Named `*.repository.spec.ts` so it runs under jest.integration.config.ts
 * (testRegex: `.*\.repository\.spec\.ts$`). Uses the real test DB; mocks
 * StorageService and PermissionsService to keep the test focused on BCF logic.
 *
 * Covers:
 *  1. import → 1 topic, device link == [deviceId], viewpoint.snapshotKey set
 *  2. re-import same zip → still 1 topic (upsert by guid is idempotent)
 *  3. BCF_001 (413) when buffer exceeds limit
 *  4. BCF_002 (422) when snapshot PNG is invalid
 *  5. BCF_003 (422) when buffer is not a valid ZIP
 */
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { BcfImportService } from './bcf-import.service';
import { StorageService } from '../storage/storage.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PropertiesService } from '../properties/properties.service';
import { DevicesRepository } from '../devices/devices.repository';
import { DeviceCategory } from '@prisma/client';
import { writeBcfZip, ParsedTopic } from './bcf-zip';
import { toIfcGuid } from '../export/ifc-guid';
import type { OrgMemberContext } from '../organizations/org-context.types';

// Minimal valid 1×1 PNG (67 bytes)
const VALID_1X1_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080200000090' +
  '77533de0000000125044415478016360f8cfc000000000200016dd8a80000' +
  '000049454e44ae426082',
  'hex',
);

describe('BcfImportService (integration)', () => {
  let service: BcfImportService;
  let prisma: PrismaService;
  let orgId: string;
  let buildingId: string;
  let deviceId: string;
  const putObjectStream = jest.fn().mockResolvedValue(undefined);

  // Track subtreeIds so the PropertiesService mock can return the right value
  let subtreeIds: string[] = [];

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      providers: [
        BcfImportService,
        PrismaService,
        DevicesRepository,
        {
          provide: StorageService,
          useValue: { putObjectStream },
        },
        {
          // OWNER always passes assertCanConfigure
          provide: PermissionsService,
          useValue: { assertCanConfigure: jest.fn().mockResolvedValue(undefined) },
        },
        {
          // Return real subtreeIds from the seeded DB via closure
          provide: PropertiesService,
          useValue: { subtreePropertyIds: jest.fn().mockImplementation(() => Promise.resolve(subtreeIds)) },
        },
      ],
    }).compile();

    service = ref.get(BcfImportService);
    prisma = ref.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset the subtreeIds to empty so each test seeds its own
    subtreeIds = [];

    // Seed org + property hierarchy + device
    const org = await prisma.organization.create({
      data: { name: `BcfImport${Date.now()}${Math.floor(performance.now())}` },
    });
    orgId = org.id;

    const site = await prisma.property.create({
      data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'Site' },
    });
    const building = await prisma.property.create({
      data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'Bldg' },
    });
    buildingId = building.id;
    subtreeIds = [buildingId]; // building subtree for this test

    const user = await prisma.user.create({
      data: { email: `bcf-import-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`, emailVerified: false },
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
    // Cascade delete via Organization
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  });

  /** Build a ParsedTopic that selects deviceId via its IfcGuid */
  function buildTopic(guid: string, includeDeviceComponent = true): ParsedTopic {
    return {
      guid,
      title: 'Test clash',
      topicType: 'Clash',
      topicStatus: 'Open',
      labels: [],
      creationAuthor: 'test@x.com',
      creationDate: '2026-06-19T00:00:00Z',
      comments: [],
      viewpoints: [
        {
          guid: `${guid}-vp`,
          isPrimary: true,
          camera: {
            kind: 'perspective',
            position: [0, 0, 10],
            direction: [0, 0, -1],
            up: [0, 1, 0],
            fieldOfView: 60,
          },
          components: {
            selection: includeDeviceComponent ? [toIfcGuid(deviceId)] : [],
            visibility: { defaultVisibility: true, exceptions: [] },
          },
          clippingPlanes: [],
          snapshotPng: VALID_1X1_PNG,
        },
      ],
    };
  }

  it('imports a BCF zip: creates 1 topic, links the device, stores snapshot, calls putObjectStream', async () => {
    const topicGuid = 'aaaabbbb-0000-0000-0000-000000000001';
    const topic = buildTopic(topicGuid);
    const buf = await writeBcfZip([topic]);

    const member: OrgMemberContext = { id: 'mem-owner', organizationId: orgId, role: 'OWNER' };
    const result = await service.importBcfZip(member, buildingId, buf);

    expect(result.topicsUpserted).toBe(1);

    // Verify topic persisted
    const dbTopic = await prisma.bcfTopic.findFirst({ where: { organizationId: orgId, guid: topicGuid } });
    expect(dbTopic).not.toBeNull();
    expect(dbTopic!.title).toBe('Test clash');
    expect(dbTopic!.propertyId).toBe(buildingId);

    // Verify device link
    const links = await prisma.bcfTopicDevice.findMany({ where: { topicId: dbTopic!.id } });
    expect(links).toHaveLength(1);
    expect(links[0].deviceId).toBe(deviceId);

    // Verify viewpoint snapshotKey is set
    const vp = await prisma.bcfViewpoint.findFirst({ where: { topicId: dbTopic!.id } });
    expect(vp).not.toBeNull();
    expect(vp!.snapshotKey).toMatch(`org/${orgId}/bcf/${topicGuid}/`);

    // Verify storage was called
    expect(putObjectStream).toHaveBeenCalledTimes(1);
    expect(putObjectStream).toHaveBeenCalledWith(
      expect.stringContaining(`org/${orgId}/bcf/${topicGuid}/`),
      expect.anything(),
      'image/png',
    );
  });

  it('re-importing the same zip is idempotent (upsert by guid → still 1 topic)', async () => {
    const topicGuid = 'aaaabbbb-0000-0000-0000-000000000002';
    const topic = buildTopic(topicGuid);
    const buf = await writeBcfZip([topic]);

    const member: OrgMemberContext = { id: 'mem-owner', organizationId: orgId, role: 'OWNER' };

    // First import
    await service.importBcfZip(member, buildingId, buf);

    // Second import (re-import same zip)
    await service.importBcfZip(member, buildingId, buf);

    const count = await prisma.bcfTopic.count({ where: { organizationId: orgId, guid: topicGuid } });
    expect(count).toBe(1);
  });

  it('throws BCF_001 (413) when buffer is too large', async () => {
    const member: OrgMemberContext = { id: 'mem-owner', organizationId: orgId, role: 'OWNER' };
    const oversized = Buffer.alloc(51 * 1024 * 1024); // 51 MB > 50 MB limit
    await expect(service.importBcfZip(member, buildingId, oversized)).rejects.toMatchObject({
      code: 'BCF_001',
    });
  });

  it('throws BCF_003 (422) when buffer is not a valid ZIP', async () => {
    const member: OrgMemberContext = { id: 'mem-owner', organizationId: orgId, role: 'OWNER' };
    const notAZip = Buffer.from('this is not a zip file at all');
    await expect(service.importBcfZip(member, buildingId, notAZip)).rejects.toMatchObject({
      code: 'BCF_003',
    });
  });

  it('re-importing with no device components clears stale BcfTopicDevice rows', async () => {
    const topicGuid = 'aaaabbbb-0000-0000-0000-000000000010';

    // First import: viewpoint selects deviceId → link created
    const topicWithDevice = buildTopic(topicGuid, true /* includeDeviceComponent */);
    const bufWith = await writeBcfZip([topicWithDevice]);
    const member: OrgMemberContext = { id: 'mem-owner', organizationId: orgId, role: 'OWNER' };
    await service.importBcfZip(member, buildingId, bufWith);

    const dbTopic = await prisma.bcfTopic.findFirstOrThrow({ where: { organizationId: orgId, guid: topicGuid } });
    const linksBefore = await prisma.bcfTopicDevice.findMany({ where: { topicId: dbTopic.id } });
    expect(linksBefore).toHaveLength(1);

    // Second import: same guid, viewpoint selects NOTHING → device link must be cleared
    const topicNoDevice = buildTopic(topicGuid, false /* includeDeviceComponent */);
    const bufWithout = await writeBcfZip([topicNoDevice]);
    await service.importBcfZip(member, buildingId, bufWithout);

    const linksAfter = await prisma.bcfTopicDevice.findMany({ where: { topicId: dbTopic.id } });
    expect(linksAfter).toHaveLength(0);
  });

  it('throws BCF_002 (422) when primary viewpoint has no valid PNG', async () => {
    const topicGuid = 'aaaabbbb-0000-0000-0000-000000000003';
    const topic: ParsedTopic = {
      ...buildTopic(topicGuid),
      viewpoints: [
        {
          guid: `${topicGuid}-vp`,
          isPrimary: true,
          camera: { kind: 'perspective', position: [0, 0, 1], direction: [0, 0, -1], up: [0, 1, 0], fieldOfView: 60 },
          components: { selection: [], visibility: { defaultVisibility: true, exceptions: [] } },
          clippingPlanes: [],
          snapshotPng: Buffer.from('not a png'),  // invalid header
        },
      ],
    };
    const buf = await writeBcfZip([topic]);

    const member: OrgMemberContext = { id: 'mem-owner', organizationId: orgId, role: 'OWNER' };
    await expect(service.importBcfZip(member, buildingId, buf)).rejects.toMatchObject({
      code: 'BCF_002',
    });
  });
});
