import { Test, TestingModule } from '@nestjs/testing';
import { DataSourcesService } from '../data-sources.service';
import { DataSourcesRepository } from '../data-sources.repository';
import { MetricRecord } from '../data-sources.interface';

const mockRepository = {
  createMetric: jest.fn(),
  findLatestForUser: jest.fn(),
  findLatestForUsers: jest.fn(),
};

describe('DataSourcesService', () => {
  let service: DataSourcesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataSourcesService,
        { provide: DataSourcesRepository, useValue: mockRepository },
      ],
    }).compile();
    service = module.get(DataSourcesService);
  });

  describe('ingest', () => {
    it('writes metric via repository', async () => {
      mockRepository.createMetric.mockResolvedValue(undefined);
      await service.ingest('user-1', {
        bandwidthDown: 100,
        bandwidthUp: 10,
        latency: 20,
        connectionQuality: '4g',
      });
      expect(mockRepository.createMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          sourceType: 'browser',
          bandwidthDown: 100,
          bandwidthUp: 10,
          latency: 20,
          connectionQuality: '4g',
        }),
      );
    });

    it('ignores unknown fields in raw payload', async () => {
      mockRepository.createMetric.mockResolvedValue(undefined);
      await service.ingest('user-1', { bandwidthDown: 50, unknownField: 'x' });
      const callArg = mockRepository.createMetric.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg['unknownField']).toBeUndefined();
    });

    it('passes deviceId through to repository when present', async () => {
      mockRepository.createMetric.mockResolvedValue(undefined);
      await service.ingest('user-1', { deviceId: 'device-uuid-1', bandwidthDown: 50 });
      expect(mockRepository.createMetric).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'device-uuid-1' }),
      );
    });

    it('passes tag through to repository when present', async () => {
      mockRepository.createMetric.mockResolvedValue(undefined);
      await service.ingest('user-1', { tag: 'speedtest', bandwidthDown: 50 });
      expect(mockRepository.createMetric).toHaveBeenCalledWith(
        expect.objectContaining({ tag: 'speedtest' }),
      );
    });

    it('defaults deviceId to null when absent', async () => {
      mockRepository.createMetric.mockResolvedValue(undefined);
      await service.ingest('user-1', { bandwidthDown: 50 });
      expect(mockRepository.createMetric).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: null }),
      );
    });

    it('defaults tag to null when absent', async () => {
      mockRepository.createMetric.mockResolvedValue(undefined);
      await service.ingest('user-1', { bandwidthDown: 50 });
      expect(mockRepository.createMetric).toHaveBeenCalledWith(
        expect.objectContaining({ tag: null }),
      );
    });

    it('ignores non-string deviceId', async () => {
      mockRepository.createMetric.mockResolvedValue(undefined);
      await service.ingest('user-1', { deviceId: 12345, bandwidthDown: 50 });
      expect(mockRepository.createMetric).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: null }),
      );
    });

    it('ignores non-string tag', async () => {
      mockRepository.createMetric.mockResolvedValue(undefined);
      await service.ingest('user-1', { tag: 42, bandwidthDown: 50 });
      expect(mockRepository.createMetric).toHaveBeenCalledWith(
        expect.objectContaining({ tag: null }),
      );
    });

    it('drops non-finite numbers (Infinity / NaN)', async () => {
      mockRepository.createMetric.mockResolvedValue(undefined);
      await service.ingest('user-1', { bandwidthDown: Infinity, latency: NaN, bandwidthUp: 10 });
      expect(mockRepository.createMetric).toHaveBeenCalledWith(
        expect.objectContaining({ bandwidthDown: null, latency: null, bandwidthUp: 10 }),
      );
    });

    it('drops an over-magnitude number', async () => {
      mockRepository.createMetric.mockResolvedValue(undefined);
      await service.ingest('user-1', { bandwidthDown: 1e308 });
      expect(mockRepository.createMetric).toHaveBeenCalledWith(
        expect.objectContaining({ bandwidthDown: null }),
      );
    });

    it('accepts a large but bounded number', async () => {
      mockRepository.createMetric.mockResolvedValue(undefined);
      await service.ingest('user-1', { bandwidthDown: 1_000_000 });
      expect(mockRepository.createMetric).toHaveBeenCalledWith(
        expect.objectContaining({ bandwidthDown: 1_000_000 }),
      );
    });

    it('drops over-length strings (connectionQuality, tag)', async () => {
      mockRepository.createMetric.mockResolvedValue(undefined);
      await service.ingest('user-1', {
        connectionQuality: 'q'.repeat(300),
        tag: 't'.repeat(300),
        bandwidthDown: 50,
      });
      expect(mockRepository.createMetric).toHaveBeenCalledWith(
        expect.objectContaining({ connectionQuality: null, tag: null, bandwidthDown: 50 }),
      );
    });
  });

  describe('getLatestMetric', () => {
    it('returns null when no metrics exist', async () => {
      mockRepository.findLatestForUser.mockResolvedValue(null);
      const result = await service.getLatestMetric('user-1');
      expect(result).toBeNull();
    });

    it('maps DeviceMetric row to MetricRecord', async () => {
      const now = new Date();
      mockRepository.findLatestForUser.mockResolvedValue({
        id: 'metric-1',
        userId: 'user-1',
        sourceType: 'browser',
        bandwidthDown: 100,
        bandwidthUp: 20,
        latency: 15,
        connectionQuality: '4g',
        time: now,
      });
      const result = await service.getLatestMetric('user-1');
      expect(result).toEqual<MetricRecord>({
        sourceType: 'browser',
        bandwidthDown: 100,
        bandwidthUp: 20,
        latency: 15,
        connectionQuality: '4g',
        timestamp: now.toISOString(),
      });
    });
  });

  describe('getLatestMetrics (batch)', () => {
    it('returns empty map when no users provided', async () => {
      const result = await service.getLatestMetrics([]);
      expect(result).toEqual(new Map());
    });

    it('returns map of userId → MetricsDto for connected users', async () => {
      const now = new Date();
      mockRepository.findLatestForUsers.mockResolvedValue([
        {
          userId: 'user-1',
          sourceType: 'browser',
          bandwidthDown: 100,
          bandwidthUp: 10,
          latency: 20,
          connectionQuality: '4g',
          time: now,
        },
      ]);
      const result = await service.getLatestMetrics(['user-1', 'user-2']);
      expect(result.get('user-1')).toEqual(
        expect.objectContaining({ bandwidthDown: 100, latency: 20 }),
      );
      expect(result.has('user-2')).toBe(false);
    });
  });

  describe('getDataSourceStatus', () => {
    it('reports connected false when no metrics exist', async () => {
      mockRepository.findLatestForUser.mockResolvedValue(null);
      const statuses = await service.getDataSourceStatus('user-1');
      const browser = statuses.find((s) => s.type === 'browser');
      expect(browser!.connected).toBe(false);
      expect(browser!.lastSeen).toBeNull();
    });

    it('reports connected true when recent metric exists', async () => {
      const recent = new Date(Date.now() - 60_000);
      mockRepository.findLatestForUser.mockResolvedValue({
        userId: 'user-1',
        time: recent,
        sourceType: 'browser',
        bandwidthDown: null,
        bandwidthUp: null,
        latency: null,
        connectionQuality: null,
      });
      const statuses = await service.getDataSourceStatus('user-1');
      const browser = statuses.find((s) => s.type === 'browser');
      expect(browser!.connected).toBe(true);
      expect(browser!.lastSeen).toBe(recent.toISOString());
    });

    it('reports connected false when last metric is older than threshold', async () => {
      const old = new Date(Date.now() - 300_000);
      mockRepository.findLatestForUser.mockResolvedValue({
        userId: 'user-1',
        time: old,
        sourceType: 'browser',
        bandwidthDown: null,
        bandwidthUp: null,
        latency: null,
        connectionQuality: null,
      });
      const statuses = await service.getDataSourceStatus('user-1');
      const browser = statuses.find((s) => s.type === 'browser');
      expect(browser!.connected).toBe(false);
    });
  });
});
