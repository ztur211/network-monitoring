import { Test, TestingModule } from '@nestjs/testing';
import { DeviceMobility } from '@prisma/client';
import { OnboardingService } from '../onboarding.service';
import { NetworksService } from '../../networks/networks.service';
import { NetworksRepository } from '../../networks/networks.repository';
import { DevicesService } from '../../devices/devices.service';
import { DevicesRepository } from '../../devices/devices.repository';
import { AiService } from '../../ai/ai.service';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { RedisService } from '../../redis/redis.service';
import { GEOCODING_PROVIDER } from '../../map/geocoding/geocoding.interface';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const mockNetworksService = {
  createNetwork: jest.fn(),
};

const mockNetworksRepo = {
  countByUserId: jest.fn(),
  findAllByUserId: jest.fn(),
  updateWithVersion: jest.fn(),
};

const mockDevicesService = {
  createBrowserDevice: jest.fn(),
};

const mockDevicesRepo = {
  create: jest.fn(),
};

const mockAi = {
  generateOnboardingMessage: jest.fn(),
};

const mockConflict = {
  emitEntityEvent: jest.fn(),
};

const mockGeocoder = {
  geocode: jest.fn(),
};

describe('OnboardingService', () => {
  let service: OnboardingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: RedisService, useValue: mockRedis },
        { provide: NetworksService, useValue: mockNetworksService },
        { provide: NetworksRepository, useValue: mockNetworksRepo },
        { provide: DevicesService, useValue: mockDevicesService },
        { provide: DevicesRepository, useValue: mockDevicesRepo },
        { provide: AiService, useValue: mockAi },
        { provide: ConflictResolutionService, useValue: mockConflict },
        { provide: GEOCODING_PROVIDER, useValue: mockGeocoder },
      ],
    }).compile();

    service = module.get(OnboardingService);
    jest.clearAllMocks();

    mockNetworksRepo.countByUserId.mockResolvedValue(0);
    mockNetworksRepo.findAllByUserId.mockResolvedValue([]);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
    mockAi.generateOnboardingMessage.mockResolvedValue({
      content: 'Bot message',
      providerStatus: 'ok',
      tokensUsed: 50,
    });
  });

  describe('handleTurn', () => {
    it('throws ONBOARD_001 ALREADY_COMPLETE when a network exists AND no in-flight state', async () => {
      mockNetworksRepo.countByUserId.mockResolvedValue(1);
      mockRedis.get.mockResolvedValue(null); // no redis state — user has truly completed before

      await expect(
        service.handleTurn('user-1', '127.0.0.1', { browserDeviceId: 'bd-1' }),
      ).rejects.toThrow(NodeScopeException);
    });

    it('proceeds mid-flow even after SaveNetwork created a Network row (regression: 2026-05-21 smoke)', async () => {
      // Smoke caught: state-machine fires SaveNetwork at the `address` step,
      // creating a Network row. Every subsequent turn (browserDeviceName,
      // mobility, ...) was 409-ing because the guard read "user has a
      // network → onboarding done". The wizard must finish its own flow.
      mockNetworksRepo.countByUserId.mockResolvedValue(1);
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          stepId: 'browserDeviceName',
          progress: { networkName: 'Home', homeAddress: '123 Maple' },
        }),
      );

      const result = await service.handleTurn('user-1', '127.0.0.1', {
        browserDeviceId: 'bd-1',
        fieldValues: { name: 'My Laptop' },
      });

      expect(result.stepId).toBe('mobility');
      expect(result.complete).toBe(false);
    });

    it('on first turn (no Redis state), starts at welcome → advances to networkName', async () => {
      const result = await service.handleTurn('user-1', '127.0.0.1', {
        browserDeviceId: 'bd-1',
      });
      expect(result.stepId).toBe('networkName');
      expect(result.botMessage).toBe('Bot message');
      expect(result.fields.map((f) => f.key)).toContain('name');
    });

    it('persists state to Redis with 24h TTL', async () => {
      await service.handleTurn('user-1', '127.0.0.1', { browserDeviceId: 'bd-1' });

      expect(mockRedis.set).toHaveBeenCalledWith(
        'onboarding:state:user-1',
        expect.stringContaining('networkName'),
        'EX',
        24 * 60 * 60,
      );
    });

    it('loads existing state and advances from it', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ stepId: 'networkName', progress: {} }),
      );

      const result = await service.handleTurn('user-1', '127.0.0.1', {
        browserDeviceId: 'bd-1',
        fieldValues: { name: 'Home' },
      });
      expect(result.stepId).toBe('address');
      expect(result.progress.networkName).toBe('Home');
    });

    it('SaveNetwork side effect calls networksService.createNetwork when no network exists', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ stepId: 'address', progress: { networkName: 'Home' } }),
      );
      mockGeocoder.geocode.mockResolvedValue(null);
      mockNetworksService.createNetwork.mockResolvedValue({ id: 'net-1' });

      await service.handleTurn('user-1', '127.0.0.1', {
        browserDeviceId: 'bd-1',
        fieldValues: { address: '1 Main St' },
      });

      expect(mockNetworksService.createNetwork).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ name: 'Home', homeAddress: '1 Main St' }),
      );
    });

    it('SaveBrowserDevice side effect calls devicesService.createBrowserDevice with the body browserDeviceId', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          stepId: 'mobility',
          progress: { networkName: 'Home', browserDeviceName: 'Laptop' },
        }),
      );
      mockNetworksRepo.findAllByUserId.mockResolvedValue([
        { id: 'net-1', userId: 'user-1', name: 'Home', version: 1 } as any,
      ]);
      mockDevicesService.createBrowserDevice.mockResolvedValue({ id: 'dev-1' });

      await service.handleTurn('user-1', '127.0.0.1', {
        browserDeviceId: 'bd-uuid-123',
        chipChoice: 'HOME_ONLY',
      });

      expect(mockDevicesService.createBrowserDevice).toHaveBeenCalledWith(
        'user-1',
        'bd-uuid-123',
        'Laptop',
        'HOME_ONLY',
        'net-1',
      );
    });

    it('SaveHomeIp uses the request IP, not the sentinel from the state machine', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          stepId: 'confirmHomeIp',
          progress: { networkName: 'Home' },
        }),
      );
      mockNetworksRepo.findAllByUserId.mockResolvedValue([
        { id: 'net-1', userId: 'user-1', name: 'Home', version: 1 } as any,
      ]);
      mockNetworksRepo.updateWithVersion.mockResolvedValue({ id: 'net-1', version: 2 } as any);

      await service.handleTurn('user-1', '203.0.113.5', {
        browserDeviceId: 'bd-1',
        chipChoice: 'yes',
      });

      expect(mockNetworksRepo.updateWithVersion).toHaveBeenCalledWith(
        'net-1',
        'user-1',
        expect.objectContaining({ homePublicIp: '203.0.113.5' }),
        1,
      );
    });

    it('GeocodeAddress side effect calls geocoder + updates network with lat/lng', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ stepId: 'address', progress: { networkName: 'Home' } }),
      );
      mockGeocoder.geocode.mockResolvedValue({
        latitude: 40.7128,
        longitude: -74.006,
        displayName: 'NYC',
      });
      mockNetworksService.createNetwork.mockResolvedValue({ id: 'net-1' });
      mockNetworksRepo.findAllByUserId
        .mockResolvedValueOnce([]) // first call (SaveNetwork enactment)
        .mockResolvedValue([
          { id: 'net-1', userId: 'user-1', name: 'Home', version: 1 } as any,
        ]); // second call (GeocodeAddress enactment after SaveNetwork created it)
      mockNetworksRepo.updateWithVersion.mockResolvedValue({ id: 'net-1', version: 2 } as any);

      await service.handleTurn('user-1', '127.0.0.1', {
        browserDeviceId: 'bd-1',
        fieldValues: { address: '1 Main St' },
      });

      expect(mockGeocoder.geocode).toHaveBeenCalledWith('1 Main St');
      expect(mockNetworksRepo.updateWithVersion).toHaveBeenCalledWith(
        'net-1',
        'user-1',
        expect.objectContaining({ homeLatitude: 40.7128, homeLongitude: -74.006 }),
        1,
      );
    });

    it('emits v1:onboarding:turn after each turn', async () => {
      await service.handleTurn('user-1', '127.0.0.1', { browserDeviceId: 'bd-1' });
      expect(mockConflict.emitEntityEvent).toHaveBeenCalledWith(
        'v1:onboarding:turn',
        expect.objectContaining({ stepId: 'networkName', complete: false }),
        'user-1',
      );
    });

    it('clears Redis state when complete=true', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          stepId: 'speeds',
          progress: { networkName: 'Home' },
        }),
      );

      const result = await service.handleTurn('user-1', '127.0.0.1', {
        browserDeviceId: 'bd-1',
        chipChoice: 'skip',
      });

      expect(result.complete).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith('onboarding:state:user-1');
    });
  });

  describe('skip', () => {
    it('writes dismissed flag with 30-day TTL and removes state', async () => {
      await service.skip('user-1');
      expect(mockRedis.set).toHaveBeenCalledWith(
        'onboarding:dismissed:user-1',
        '1',
        'EX',
        30 * 24 * 60 * 60,
      );
      expect(mockRedis.del).toHaveBeenCalledWith('onboarding:state:user-1');
    });
  });

  describe('isDismissedForSession', () => {
    it('returns true when the flag exists', async () => {
      mockRedis.get.mockResolvedValue('1');
      expect(await service.isDismissedForSession('user-1')).toBe(true);
    });

    it('returns false when the flag is missing', async () => {
      mockRedis.get.mockResolvedValue(null);
      expect(await service.isDismissedForSession('user-1')).toBe(false);
    });
  });
});
