import { Test } from '@nestjs/testing';
import { DeviceFocusContextProvider } from '../device-focus-context.provider';
import { PermissionsRepository } from '../../../permissions/permissions.repository';
import { PermissionsService } from '../../../permissions/permissions.service';
import { MonitoringRepository } from '../../../monitoring/monitoring.repository';
import { PrismaService } from '../../../prisma/prisma.service';

const ORG = 'org-1';
const USER = 'user-1';
const DEVICE_ID = 'dev-1';
const PROPERTY_ID = 'prop-1';

const mockPrisma = {
  device: {
    findFirst: jest.fn(),
  },
  deviceConnection: {
    findMany: jest.fn(),
  },
};

const mockPermRepo = {
  findMember: jest.fn(),
};

const mockPermService = {
  inScope: jest.fn(),
};

const mockMonitoringRepo = {
  listStatus: jest.fn(),
  metricNames: jest.fn(),
  queryMetric: jest.fn(),
  recentStatusEvents: jest.fn(),
};

const OWNER_MEMBER = { id: 'mem-1', organizationId: ORG, role: 'OWNER' as const, userId: USER };
const ADMIN_MEMBER = { id: 'mem-2', organizationId: ORG, role: 'ADMIN' as const, userId: USER };

const makeDevice = (overrides = {}) => ({
  id: DEVICE_ID,
  name: 'Core Router',
  category: 'ROUTER',
  ipAddress: '10.0.0.1',
  floor: 2,
  floorLabel: 'Level 2',
  propertyId: PROPERTY_ID,
  ...overrides,
});

describe('DeviceFocusContextProvider', () => {
  let provider: DeviceFocusContextProvider;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DeviceFocusContextProvider,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PermissionsRepository, useValue: mockPermRepo },
        { provide: PermissionsService, useValue: mockPermService },
        { provide: MonitoringRepository, useValue: mockMonitoringRepo },
      ],
    }).compile();

    provider = module.get(DeviceFocusContextProvider);
    jest.clearAllMocks();

    // Default: all data is empty
    mockMonitoringRepo.listStatus.mockResolvedValue([]);
    mockMonitoringRepo.metricNames.mockResolvedValue([]);
    mockMonitoringRepo.queryMetric.mockResolvedValue([]);
    mockMonitoringRepo.recentStatusEvents.mockResolvedValue([]);
    mockPrisma.deviceConnection.findMany.mockResolvedValue([]);
  });

  describe('visibility gate', () => {
    it('returns empty string when device does not exist in org', async () => {
      mockPrisma.device.findFirst.mockResolvedValue(null);
      mockPermRepo.findMember.mockResolvedValue(OWNER_MEMBER);

      const result = await provider.getContext(ORG, USER, DEVICE_ID);

      expect(result).toBe('');
      expect(mockMonitoringRepo.listStatus).not.toHaveBeenCalled();
    });

    it('returns empty string when non-member requests a device', async () => {
      mockPrisma.device.findFirst.mockResolvedValue(makeDevice());
      mockPermRepo.findMember.mockResolvedValue(null);

      const result = await provider.getContext(ORG, USER, DEVICE_ID);

      expect(result).toBe('');
      expect(mockMonitoringRepo.listStatus).not.toHaveBeenCalled();
    });

    it('returns empty string when ADMIN is not in scope', async () => {
      mockPrisma.device.findFirst.mockResolvedValue(makeDevice());
      mockPermRepo.findMember.mockResolvedValue(ADMIN_MEMBER);
      mockPermService.inScope.mockResolvedValue(false);

      const result = await provider.getContext(ORG, USER, DEVICE_ID);

      expect(result).toBe('');
      expect(mockMonitoringRepo.listStatus).not.toHaveBeenCalled();
    });

    it('returns a section for OWNER without calling inScope', async () => {
      mockPrisma.device.findFirst.mockResolvedValue(makeDevice());
      mockPermRepo.findMember.mockResolvedValue(OWNER_MEMBER);

      const result = await provider.getContext(ORG, USER, DEVICE_ID);

      expect(result).toContain('## Focused Device');
      expect(mockPermService.inScope).not.toHaveBeenCalled();
    });

    it('returns a section for ADMIN who is in scope', async () => {
      mockPrisma.device.findFirst.mockResolvedValue(makeDevice());
      mockPermRepo.findMember.mockResolvedValue(ADMIN_MEMBER);
      mockPermService.inScope.mockResolvedValue(true);

      const result = await provider.getContext(ORG, USER, DEVICE_ID);

      expect(result).toContain('## Focused Device');
      expect(mockPermService.inScope).toHaveBeenCalledWith(ORG, ADMIN_MEMBER.id, PROPERTY_ID);
    });
  });

  describe('device info section', () => {
    beforeEach(() => {
      mockPrisma.device.findFirst.mockResolvedValue(makeDevice());
      mockPermRepo.findMember.mockResolvedValue(OWNER_MEMBER);
    });

    it('includes device name, category, IP, and floor label', async () => {
      const result = await provider.getContext(ORG, USER, DEVICE_ID);

      expect(result).toContain('Core Router');
      expect(result).toContain('ROUTER');
      expect(result).toContain('10.0.0.1');
      expect(result).toContain('Level 2');
    });

    it('uses floor number when floorLabel is absent', async () => {
      mockPrisma.device.findFirst.mockResolvedValue(makeDevice({ floorLabel: null, floor: 3 }));

      const result = await provider.getContext(ORG, USER, DEVICE_ID);

      expect(result).toContain('3');
    });
  });

  describe('current status section', () => {
    beforeEach(() => {
      mockPrisma.device.findFirst.mockResolvedValue(makeDevice());
      mockPermRepo.findMember.mockResolvedValue(OWNER_MEMBER);
    });

    it('shows state, latency, and lastChangeAt when status exists', async () => {
      mockMonitoringRepo.listStatus.mockResolvedValue([
        {
          deviceId: DEVICE_ID,
          state: 'UP',
          latencyMs: 12,
          lastChangeAt: new Date('2026-06-24T10:00:00Z'),
          lastCheckAt: new Date('2026-06-24T10:01:00Z'),
          lastOkAt: new Date('2026-06-24T10:01:00Z'),
        },
      ]);

      const result = await provider.getContext(ORG, USER, DEVICE_ID);

      expect(result).toContain('UP');
      expect(result).toContain('12');
      expect(result).toContain('2026-06-24');
    });

    it('shows UNKNOWN when no status row', async () => {
      mockMonitoringRepo.listStatus.mockResolvedValue([]);

      const result = await provider.getContext(ORG, USER, DEVICE_ID);

      expect(result).toContain('UNKNOWN');
    });
  });

  describe('recent metrics section', () => {
    beforeEach(() => {
      mockPrisma.device.findFirst.mockResolvedValue(makeDevice());
      mockPermRepo.findMember.mockResolvedValue(OWNER_MEMBER);
    });

    it('shows "no recent data" when there are no metrics', async () => {
      mockMonitoringRepo.metricNames.mockResolvedValue([]);

      const result = await provider.getContext(ORG, USER, DEVICE_ID);

      expect(result).toContain('no recent data');
    });

    it('renders a metric line with last/min/max/avg when data exists', async () => {
      mockMonitoringRepo.metricNames.mockResolvedValue(['cpu_percent']);
      mockMonitoringRepo.queryMetric.mockResolvedValue([
        { bucket: new Date('2026-06-24T09:00:00Z'), avg: 45.5 },
        { bucket: new Date('2026-06-24T09:30:00Z'), avg: 60.0 },
        { bucket: new Date('2026-06-24T10:00:00Z'), avg: 30.0 },
      ]);

      const result = await provider.getContext(ORG, USER, DEVICE_ID);

      expect(result).toContain('cpu_percent');
      expect(result).toContain('last=30');
      expect(result).toContain('min=30');
      expect(result).toContain('max=60');
      expect(result).toContain('avg=45');
    });

    it('caps metric names at 6 and does not throw on empty queryMetric', async () => {
      const names = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
      mockMonitoringRepo.metricNames.mockResolvedValue(names);
      mockMonitoringRepo.queryMetric.mockResolvedValue([]);

      const result = await provider.getContext(ORG, USER, DEVICE_ID);

      // Only 6 should appear; "no recent data" should appear for ones with no data
      const calledNames = mockMonitoringRepo.queryMetric.mock.calls.map((c: unknown[]) => c[2]);
      expect(calledNames).toHaveLength(6);
      expect(calledNames).not.toContain('m7');
    });
  });

  describe('recent events section', () => {
    beforeEach(() => {
      mockPrisma.device.findFirst.mockResolvedValue(makeDevice());
      mockPermRepo.findMember.mockResolvedValue(OWNER_MEMBER);
    });

    it('shows "none recorded" when no events', async () => {
      mockMonitoringRepo.recentStatusEvents.mockResolvedValue([]);

      const result = await provider.getContext(ORG, USER, DEVICE_ID);

      expect(result).toContain('none recorded');
    });

    it('renders events with time, state, and source', async () => {
      mockMonitoringRepo.recentStatusEvents.mockResolvedValue([
        { time: new Date('2026-06-24T09:55:00Z'), state: 'DOWN', source: 'icmp' },
        { time: new Date('2026-06-24T10:00:00Z'), state: 'UP', source: 'icmp' },
      ]);

      const result = await provider.getContext(ORG, USER, DEVICE_ID);

      expect(result).toContain('DOWN');
      expect(result).toContain('icmp');
    });
  });

  describe('connections section', () => {
    beforeEach(() => {
      mockPrisma.device.findFirst.mockResolvedValue(makeDevice());
      mockPermRepo.findMember.mockResolvedValue(OWNER_MEMBER);
    });

    it('shows "none recorded" when no connections', async () => {
      mockPrisma.deviceConnection.findMany.mockResolvedValue([]);

      const result = await provider.getContext(ORG, USER, DEVICE_ID);

      expect(result).toContain('none recorded');
    });

    it('renders connections as A → B [type]', async () => {
      mockPrisma.deviceConnection.findMany.mockResolvedValue([
        {
          id: 'conn-1',
          connectionType: 'ETHERNET',
          sourceDevice: { name: 'Core Router' },
          targetDevice: { name: 'Access Switch' },
        },
      ]);

      const result = await provider.getContext(ORG, USER, DEVICE_ID);

      expect(result).toContain('Core Router → Access Switch [ETHERNET]');
    });
  });

  describe('full assembly — visible device with all data', () => {
    it('produces a complete focused section with header, status, metrics, events, connections', async () => {
      mockPrisma.device.findFirst.mockResolvedValue(makeDevice());
      mockPermRepo.findMember.mockResolvedValue(OWNER_MEMBER);

      mockMonitoringRepo.listStatus.mockResolvedValue([
        { deviceId: DEVICE_ID, state: 'UP', latencyMs: 5, lastChangeAt: new Date('2026-06-24T08:00:00Z') },
      ]);
      mockMonitoringRepo.metricNames.mockResolvedValue(['cpu_percent']);
      mockMonitoringRepo.queryMetric.mockResolvedValue([
        { bucket: new Date('2026-06-24T09:00:00Z'), avg: 50 },
      ]);
      mockMonitoringRepo.recentStatusEvents.mockResolvedValue([
        { time: new Date('2026-06-24T08:00:00Z'), state: 'UP', source: 'icmp' },
      ]);
      mockPrisma.deviceConnection.findMany.mockResolvedValue([
        {
          connectionType: 'ETHERNET',
          sourceDevice: { name: 'Core Router' },
          targetDevice: { name: 'Access Switch' },
        },
      ]);

      const result = await provider.getContext(ORG, USER, DEVICE_ID);

      expect(result).toContain('## Focused Device');
      expect(result).toContain('Core Router');
      expect(result).toContain('UP');
      expect(result).toContain('cpu_percent');
      expect(result).toContain('icmp');
      expect(result).toContain('Core Router → Access Switch [ETHERNET]');
    });
  });
});
