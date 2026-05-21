import { Test, TestingModule } from '@nestjs/testing';
import { MapService } from '../map.service';
import { MapRepository } from '../map.repository';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

const mockMapRepo: jest.Mocked<MapRepository> = {
  findDevicesInBbox: jest.fn(),
  findFiberRunsInBbox: jest.fn(),
  findCircuitsInBbox: jest.fn(),
} as unknown as jest.Mocked<MapRepository>;

const makeDevice = () => ({
  id: 'dev-1',
  userId: 'user-1',
  networkId: null,
  name: 'Router',
  category: 'ROUTER',
  mobility: 'UNKNOWN',
  browserDeviceId: null,
  latitude: 40.0,
  longitude: -74.0,
  floor: null,
  floorLabel: null,
  ipAddress: null,
  macAddress: null,
  notes: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('MapService', () => {
  let service: MapService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MapService,
        { provide: MapRepository, useValue: mockMapRepo },
      ],
    }).compile();

    service = module.get<MapService>(MapService);
    jest.clearAllMocks();
  });

  describe('getDevicesInBbox', () => {
    it('returns devices in bbox', async () => {
      mockMapRepo.findDevicesInBbox.mockResolvedValue([makeDevice() as any]);

      const result = await service.getDevicesInBbox('user-1', '-75,39,-73,41');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('dev-1');
    });

    it('throws GEN_001 for invalid bbox format', async () => {
      await expect(service.getDevicesInBbox('user-1', 'invalid')).rejects.toThrow(NodeScopeException);
    });

    it('throws GEN_001 when bbox has invalid coordinate range', async () => {
      await expect(service.getDevicesInBbox('user-1', '-200,39,-73,41')).rejects.toThrow(NodeScopeException);
    });
  });

  describe('getFiberRunsInBbox', () => {
    it('returns fiber runs in bbox', async () => {
      mockMapRepo.findFiberRunsInBbox.mockResolvedValue([]);

      const result = await service.getFiberRunsInBbox('user-1', '-75,39,-73,41');
      expect(result.items).toHaveLength(0);
    });
  });

  describe('getCircuitsInBbox', () => {
    it('returns circuits in bbox', async () => {
      mockMapRepo.findCircuitsInBbox.mockResolvedValue([]);

      const result = await service.getCircuitsInBbox('user-1', '-75,39,-73,41');
      expect(result.items).toHaveLength(0);
    });
  });
});
