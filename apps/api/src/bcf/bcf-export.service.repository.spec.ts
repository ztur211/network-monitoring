/**
 * Integration test for BcfExportService.
 *
 * Named `*.repository.spec.ts` so it runs under jest.integration.config.ts.
 * Uses the real test DB; mocks StorageService (MinIO is not running) and
 * PermissionsService/PropertiesService. The seeded topic has a viewpoint with
 * NO snapshot, so storage is never exercised on this path.
 *
 * Covers:
 *  1. export → readBcfZip round-trips guid / title / camera
 */
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { BcfExportService } from './bcf-export.service';
import { StorageService } from '../storage/storage.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PropertiesService } from '../properties/properties.service';
import { readBcfZip } from './bcf-zip';
import type { OrgMemberContext } from '../organizations/org-context.types';

describe('BcfExportService (integration)', () => {
  let service: BcfExportService;
  let prisma: PrismaService;
  let orgId: string;
  let buildingId: string;

  const getObjectStream = jest.fn();
  const inScope = jest.fn().mockResolvedValue(true);
  // findInOrg returns a truthy "building" so assertView passes; closure over buildingId.
  const findInOrg = jest.fn();

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      providers: [
        BcfExportService,
        PrismaService,
        { provide: StorageService, useValue: { getObjectStream } },
        { provide: PermissionsService, useValue: { inScope } },
        { provide: PropertiesService, useValue: { findInOrg } },
      ],
    }).compile();

    service = ref.get(BcfExportService);
    prisma = ref.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    inScope.mockResolvedValue(true);

    const org = await prisma.organization.create({
      data: { name: `BcfExport${Date.now()}${Math.floor(performance.now())}` },
    });
    orgId = org.id;

    const site = await prisma.property.create({
      data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'Site' },
    });
    const building = await prisma.property.create({
      data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'Bldg' },
    });
    buildingId = building.id;

    findInOrg.mockResolvedValue({ id: buildingId, organizationId: orgId, type: 'BUILDING' });
  });

  afterEach(async () => {
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  });

  it('exports a topic with a viewpoint → readBcfZip round-trips guid/title/camera', async () => {
    const topicGuid = 'ffff0000-0000-0000-0000-000000000001';
    const topic = await prisma.bcfTopic.create({
      data: {
        organizationId: orgId,
        propertyId: buildingId,
        guid: topicGuid,
        title: 'Export round-trip',
        topicType: 'Issue',
        topicStatus: 'Open',
        labels: ['hvac'],
        creationAuthor: 'author@x.com',
        creationDate: new Date('2026-06-19T00:00:00Z'),
      },
    });
    await prisma.bcfViewpoint.create({
      data: {
        organizationId: orgId,
        topicId: topic.id,
        guid: `${topicGuid}-vp`,
        camera: {
          kind: 'perspective',
          position: [1, 2, 3],
          direction: [0, 0, -1],
          up: [0, 1, 0],
          fieldOfView: 45,
        },
        components: { selection: ['SOME-IFC-GUID'], visibility: { defaultVisibility: true, exceptions: [] } },
        clippingPlanes: [],
        snapshotKey: null, // no snapshot → storage not exercised
        isPrimary: true,
      },
    });

    const member: OrgMemberContext = { id: 'mem-owner', organizationId: orgId, role: 'OWNER' };
    const buf = await service.exportBcf(member, buildingId);

    // Storage never touched (no snapshotKey).
    expect(getObjectStream).not.toHaveBeenCalled();

    const parsed = await readBcfZip(buf);
    expect(parsed.topics).toHaveLength(1);
    const t = parsed.topics[0];
    expect(t.guid).toBe(topicGuid);
    expect(t.title).toBe('Export round-trip');
    expect(t.viewpoints).toHaveLength(1);
    const cam = t.viewpoints[0].camera;
    expect(cam.kind).toBe('perspective');
    expect(cam.position).toEqual([1, 2, 3]);
    expect(cam.direction).toEqual([0, 0, -1]);
    expect(cam.up).toEqual([0, 1, 0]);
    expect(cam.fieldOfView).toBe(45);
  });

  it('throws PROP_001 (404) when the member is out of scope (non-OWNER)', async () => {
    inScope.mockResolvedValue(false);
    const member: OrgMemberContext = { id: 'mem-admin', organizationId: orgId, role: 'ADMIN' };
    await expect(service.exportBcf(member, buildingId)).rejects.toMatchObject({ code: 'PROP_001' });
  });
});
