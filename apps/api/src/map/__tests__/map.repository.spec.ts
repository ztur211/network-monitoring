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
    it('returns Phase-13 columns (networkId, mobility, browserDeviceId) — guards DEVICE_COLUMNS drift', async () => {
      // latitude/longitude trigger device_location_sync, which populates the
      // geometry column so the device passes the `location IS NOT NULL` filter.
      await prisma.device.create({
        data: {
          organizationId: testOrgId,
          userId: testUserId,
          networkId: testNetworkId,
          name: 'Browser Session',
          category: DeviceCategory.BROWSER_CLIENT,
          mobility: DeviceMobility.ROAMS,
          browserDeviceId: 'browser-abc-123',
          latitude: 40.7128,
          longitude: -74.006,
        },
      });

      const devices = await repository.findDevicesInBbox(testUserId, BBOX);

      expect(devices).toHaveLength(1);
      const device = devices[0];
      expect(device.browserDeviceId).toBe('browser-abc-123');
      expect(device.networkId).toBe(testNetworkId);
      expect(device.mobility).toBe(DeviceMobility.ROAMS);
    });

    it('filters by floor while still returning Phase-13 columns', async () => {
      await prisma.device.create({
        data: {
          organizationId: testOrgId,
          userId: testUserId,
          networkId: testNetworkId,
          name: 'Floor 2 AP',
          category: DeviceCategory.ACCESS_POINT,
          mobility: DeviceMobility.HOME_ONLY,
          browserDeviceId: null,
          floor: 2,
          latitude: 40.7128,
          longitude: -74.006,
        },
      });

      const onFloor = await repository.findDevicesInBbox(testUserId, BBOX, 2);
      expect(onFloor).toHaveLength(1);
      expect(onFloor[0].networkId).toBe(testNetworkId);
      expect(onFloor[0].mobility).toBe(DeviceMobility.HOME_ONLY);

      const otherFloor = await repository.findDevicesInBbox(testUserId, BBOX, 1);
      expect(otherFloor).toHaveLength(0);
    });
  });
});
