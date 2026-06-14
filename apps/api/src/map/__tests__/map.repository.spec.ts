import { Test, TestingModule } from '@nestjs/testing';
import { DeviceCategory, DeviceMobility } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MapRepository } from '../map.repository';

/**
 * Integration tests — run against the real test database (PostGIS).
 * Requires docker compose -f docker-compose.test.yml up and TEST_DATABASE_URL set.
 *
 * findDevicesInBbox uses a raw `$queryRawUnsafe<Device[]>` with an explicit
 * DEVICE_COLUMNS list (d.* can't be used — it would deserialize the geometry
 * column and throw). The explicit list is cast to Device[], so any column it
 * omits comes back as `undefined` *silently*. These tests pin the Phase-13
 * columns so that drift fails loudly instead of dropping fields off the map
 * payload.
 */
describe('MapRepository (integration)', () => {
  let repository: MapRepository;
  let prisma: PrismaService;
  let testUserId: string;
  let testOrgId: string;
  let testNetworkId: string;

  // Same envelope the e2e test uses; the seeded point (-74.006, 40.7128) is inside it.
  const BBOX = { west: -75, south: -90, east: -73, north: 41 };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MapRepository, PrismaService],
    }).compile();
    repository = module.get<MapRepository>(MapRepository);
    prisma = module.get<PrismaService>(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { email: `maprepo-${Date.now()}@example.com`, emailVerified: false },
    });
    testUserId = user.id;

    const org = await prisma.organization.create({
      data: { name: `MapRepo Org ${Date.now()}` },
    });
    testOrgId = org.id;

    await prisma.organizationMember.create({
      data: { userId: testUserId, organizationId: testOrgId, role: 'MEMBER' },
    });

    const network = await prisma.network.create({
      data: { organizationId: testOrgId, userId: testUserId, name: 'Home' },
    });
    testNetworkId = network.id;
  });

  afterEach(async () => {
    await prisma.device.deleteMany({ where: { organizationId: testOrgId } });
    await prisma.network.deleteMany({ where: { organizationId: testOrgId } });
    await prisma.organizationMember.deleteMany({ where: { userId: testUserId } });
    await prisma.organization.deleteMany({ where: { id: testOrgId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
  });

  describe('findDevicesInBbox', () => {
    it('returns F2B columns (organizationId, networkId, propertyId, roleCode, mobility) — guards DEVICE_COLUMNS drift', async () => {
      // latitude/longitude trigger device_location_sync, which populates the
      // geometry column so the device passes the `location IS NOT NULL` filter.
      const property = await prisma.property.create({
        data: { organizationId: testOrgId, name: 'HQ Site', type: 'SITE' },
      });
      await prisma.networkProperty.create({
        data: { organizationId: testOrgId, networkId: testNetworkId, propertyId: property.id },
      });
      await prisma.device.create({
        data: {
          organizationId: testOrgId,
          userId: testUserId,
          networkId: testNetworkId,
          propertyId: property.id,
          roleCode: 'EDGE',
          name: 'Router Session',
          category: DeviceCategory.ROUTER,
          mobility: DeviceMobility.ROAMS,
          latitude: 40.7128,
          longitude: -74.006,
        },
      });

      const devices = await repository.findDevicesInBbox(testOrgId, BBOX);

      expect(devices).toHaveLength(1);
      const device = devices[0];
      expect(device.organizationId).toBe(testOrgId);
      expect(device.propertyId).toBe(property.id);
      expect(device.roleCode).toBe('EDGE');
      expect(device.networkId).toBe(testNetworkId);
      expect(device.mobility).toBe(DeviceMobility.ROAMS);

      // cleanup
      await prisma.device.deleteMany({ where: { organizationId: testOrgId } });
      await prisma.networkProperty.deleteMany({ where: { organizationId: testOrgId } });
      await prisma.property.deleteMany({ where: { organizationId: testOrgId } });
    });

    it('filters by floor while still returning F2B columns', async () => {
      const property = await prisma.property.create({
        data: { organizationId: testOrgId, name: 'HQ Site', type: 'SITE' },
      });
      await prisma.networkProperty.create({
        data: { organizationId: testOrgId, networkId: testNetworkId, propertyId: property.id },
      });
      await prisma.device.create({
        data: {
          organizationId: testOrgId,
          userId: testUserId,
          networkId: testNetworkId,
          propertyId: property.id,
          name: 'Floor 2 AP',
          category: DeviceCategory.ACCESS_POINT,
          mobility: DeviceMobility.HOME_ONLY,
          floor: 2,
          latitude: 40.7128,
          longitude: -74.006,
        },
      });

      const onFloor = await repository.findDevicesInBbox(testOrgId, BBOX, 2);
      expect(onFloor).toHaveLength(1);
      expect(onFloor[0].networkId).toBe(testNetworkId);
      expect(onFloor[0].mobility).toBe(DeviceMobility.HOME_ONLY);

      const otherFloor = await repository.findDevicesInBbox(testOrgId, BBOX, 1);
      expect(otherFloor).toHaveLength(0);

      // cleanup
      await prisma.device.deleteMany({ where: { organizationId: testOrgId } });
      await prisma.networkProperty.deleteMany({ where: { organizationId: testOrgId } });
      await prisma.property.deleteMany({ where: { organizationId: testOrgId } });
    });

    it('does NOT return devices belonging to a different org (org isolation)', async () => {
      // Create a second org with a device in the same bounding box
      const otherOrg = await prisma.organization.create({
        data: { name: `Other Org ${Date.now()}` },
      });
      const otherUser = await prisma.user.create({
        data: { email: `maprepo-other-${Date.now()}@example.com`, emailVerified: false },
      });
      await prisma.organizationMember.create({
        data: { userId: otherUser.id, organizationId: otherOrg.id, role: 'MEMBER' },
      });
      const otherNetwork = await prisma.network.create({
        data: { organizationId: otherOrg.id, userId: otherUser.id, name: 'Other Network' },
      });
      const otherProperty = await prisma.property.create({
        data: { organizationId: otherOrg.id, name: 'Other Site', type: 'SITE' },
      });
      await prisma.networkProperty.create({
        data: { organizationId: otherOrg.id, networkId: otherNetwork.id, propertyId: otherProperty.id },
      });
      await prisma.device.create({
        data: {
          organizationId: otherOrg.id,
          userId: otherUser.id,
          networkId: otherNetwork.id,
          propertyId: otherProperty.id,
          name: 'Other Org Device',
          category: DeviceCategory.ROUTER,
          latitude: 40.7128,
          longitude: -74.006,
        },
      });

      // Query scoped to testOrgId — must NOT see the other org's device
      const devices = await repository.findDevicesInBbox(testOrgId, BBOX);
      expect(devices.every((d) => d.organizationId === testOrgId)).toBe(true);

      // Cleanup
      await prisma.device.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.networkProperty.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.network.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.property.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.organizationMember.deleteMany({ where: { userId: otherUser.id } });
      await prisma.user.deleteMany({ where: { id: otherUser.id } });
      await prisma.organization.deleteMany({ where: { id: otherOrg.id } });
    });
  });
});
