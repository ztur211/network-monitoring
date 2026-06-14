import { Test, TestingModule } from '@nestjs/testing';
import { OnboardingService } from '../onboarding.service';
import { NetworksService } from '../../networks/networks.service';
import { NetworksRepository } from '../../networks/networks.repository';
import { UsersRepository } from '../../users/users.repository';
import { AiService } from '../../ai/ai.service';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { RedisService } from '../../redis/redis.service';
import { GEOCODING_PROVIDER } from '../../map/geocoding/geocoding.interface';
import { REALTIME_SERVICE } from '../../realtime/realtime.types';

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const mockNetworksService = {
  createNetwork: jest.fn(),
};

const mockNetworksRepo = {
  countByOrgId: jest.fn(),
  findAllByOrgId: jest.fn(),
  updateWithVersion: jest.fn(),
};

const mockUsersRepo = {
  markOnboardingComplete: jest.fn(),
  isOnboardingComplete: jest.fn(),
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

const mockRealtime = {
  pushToUser: jest.fn(),
  pushToTier: jest.fn(),
  pushToOrg: jest.fn(),
  getConnectionStatus: jest.fn(),
  recomputeOnHomeForUser: jest.fn(),
};

const ORG_ID = 'org-1';
const USER_ID = 'user-1';

describe('OnboardingService', () => {
  let service: OnboardingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: RedisService, useValue: mockRedis },
        { provide: NetworksService, useValue: mockNetworksService },
        { provide: NetworksRepository, useValue: mockNetworksRepo },
        { provide: UsersRepository, useValue: mockUsersRepo },
        { provide: AiService, useValue: mockAi },
        { provide: ConflictResolutionService, useValue: mockConflict },
        { provide: GEOCODING_PROVIDER, useValue: mockGeocoder },
        { provide: REALTIME_SERVICE, useValue: mockRealtime },
      ],
    }).compile();

    service = module.get(OnboardingService);
    jest.clearAllMocks();

    mockNetworksRepo.countByOrgId.mockResolvedValue(0);
    mockNetworksRepo.findAllByOrgId.mockResolvedValue([]);
    mockUsersRepo.isOnboardingComplete.mockResolvedValue(false);
    mockUsersRepo.markOnboardingComplete.mockResolvedValue(undefined);
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
    it('throws ONBOARD_002 when the durable completion marker is set and no in-flight state exists', async () => {
      // A genuinely finished user trying to restart: no in-flight Redis state,
      // but the durable DB completion marker is set.
      mockRedis.get.mockResolvedValue(null);
      mockUsersRepo.isOnboardingComplete.mockResolvedValue(true);

      await expect(
        service.handleTurn(ORG_ID, USER_ID, '127.0.0.1', {}),
      ).rejects.toMatchObject({ code: 'ONBOARD_002' });
    });

    it('resumes from the top (no ONBOARD_002) when a Network exists but onboarding was never completed', async () => {
      // The lockout regression: the 24h state TTL expired after SaveNetwork
      // created the Network row. With no completion marker we must resume the
      // wizard rather than throw — otherwise the user is locked out forever.
      mockNetworksRepo.countByOrgId.mockResolvedValue(1);
      mockNetworksRepo.findAllByOrgId.mockResolvedValue([
        { id: 'net-1', organizationId: ORG_ID, userId: USER_ID, name: 'Home', version: 1 } as any,
      ]);
      mockRedis.get.mockResolvedValue(null); // no in-flight state
      mockUsersRepo.isOnboardingComplete.mockResolvedValue(false); // never completed

      const result = await service.handleTurn(ORG_ID, USER_ID, '127.0.0.1', {});

      expect(result.stepId).toBe('networkName'); // welcome → networkName, not a 409
    });

    it('proceeds mid-flow even after SaveNetwork created a Network row (regression: 2026-05-21 smoke)', async () => {
      // Smoke caught: state-machine fires SaveNetwork at the `address` step,
      // creating a Network row. Every subsequent turn (mobility, ...) was 409-ing
      // because the guard read "user has a network → onboarding done". The wizard
      // must finish its own flow.
      mockNetworksRepo.countByOrgId.mockResolvedValue(1);
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          stepId: 'browserDeviceName',
          progress: { networkName: 'Home', homeAddress: '123 Maple' },
        }),
      );

      const result = await service.handleTurn(ORG_ID, USER_ID, '127.0.0.1', {
        fieldValues: { name: 'My Laptop' },
      });

      expect(result.stepId).toBe('mobility');
      expect(result.complete).toBe(false);
    });

    it('on first turn (no Redis state), starts at welcome → advances to networkName', async () => {
      const result = await service.handleTurn(ORG_ID, USER_ID, '127.0.0.1', {});
      expect(result.stepId).toBe('networkName');
      expect(result.botMessage).toBe('Bot message');
      expect(result.fields.map((f) => f.key)).toContain('name');
    });

    it('persists state to Redis with 24h TTL', async () => {
      await service.handleTurn(ORG_ID, USER_ID, '127.0.0.1', {});

      expect(mockRedis.set).toHaveBeenCalledWith(
        `onboarding:state:${USER_ID}`,
        expect.stringContaining('networkName'),
        'EX',
        24 * 60 * 60,
      );
    });

    it('loads existing state and advances from it', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ stepId: 'networkName', progress: {} }),
      );

      const result = await service.handleTurn(ORG_ID, USER_ID, '127.0.0.1', {
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

      await service.handleTurn(ORG_ID, USER_ID, '127.0.0.1', {
        fieldValues: { address: '1 Main St' },
      });

      expect(mockNetworksService.createNetwork).toHaveBeenCalledWith(
        ORG_ID,
        USER_ID,
        expect.objectContaining({ name: 'Home', homeAddress: '1 Main St' }),
      );
    });

    it('SaveBrowserDevice side effect is a no-op after BROWSER_CLIENT retirement', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          stepId: 'mobility',
          progress: { networkName: 'Home', browserDeviceName: 'Laptop' },
        }),
      );
      mockNetworksRepo.findAllByOrgId.mockResolvedValue([
        { id: 'net-1', organizationId: ORG_ID, userId: USER_ID, name: 'Home', version: 1 } as any,
      ]);

      // Should complete without error — the side effect is now a debug no-op
      const result = await service.handleTurn(ORG_ID, USER_ID, '127.0.0.1', {
        chipChoice: 'HOME_ONLY',
      });

      expect(result.stepId).toBeDefined();
    });

    it('SaveHomeIp uses the request IP, not the sentinel from the state machine', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          stepId: 'confirmHomeIp',
          progress: { networkName: 'Home' },
        }),
      );
      mockNetworksRepo.findAllByOrgId.mockResolvedValue([
        { id: 'net-1', organizationId: ORG_ID, userId: USER_ID, name: 'Home', version: 1 } as any,
      ]);
      mockNetworksRepo.updateWithVersion.mockResolvedValue({ id: 'net-1', version: 2 } as any);

      await service.handleTurn(ORG_ID, USER_ID, '203.0.113.5', {
        chipChoice: 'yes',
      });

      expect(mockNetworksRepo.updateWithVersion).toHaveBeenCalledWith(
        'net-1',
        ORG_ID,
        expect.objectContaining({ homePublicIp: '203.0.113.5' }),
        1,
      );
    });

    it('SaveHomeIp triggers RealtimeService.recomputeOnHomeForUser so open tabs see the new on-home status', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          stepId: 'confirmHomeIp',
          progress: { networkName: 'Home' },
        }),
      );
      mockNetworksRepo.findAllByOrgId.mockResolvedValue([
        { id: 'net-1', organizationId: ORG_ID, userId: USER_ID, name: 'Home', version: 1 } as any,
      ]);
      mockNetworksRepo.updateWithVersion.mockResolvedValue({ id: 'net-1', version: 2 } as any);

      await service.handleTurn(ORG_ID, USER_ID, '203.0.113.5', {
        chipChoice: 'yes',
      });

      expect(mockRealtime.recomputeOnHomeForUser).toHaveBeenCalledWith(USER_ID);
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
      mockNetworksRepo.findAllByOrgId
        .mockResolvedValueOnce([]) // first call (SaveNetwork enactment)
        .mockResolvedValue([
          { id: 'net-1', organizationId: ORG_ID, userId: USER_ID, name: 'Home', version: 1 } as any,
        ]); // second call (GeocodeAddress enactment after SaveNetwork created it)
      mockNetworksRepo.updateWithVersion.mockResolvedValue({ id: 'net-1', version: 2 } as any);

      await service.handleTurn(ORG_ID, USER_ID, '127.0.0.1', {
        fieldValues: { address: '1 Main St' },
      });

      expect(mockGeocoder.geocode).toHaveBeenCalledWith('1 Main St');
      expect(mockNetworksRepo.updateWithVersion).toHaveBeenCalledWith(
        'net-1',
        ORG_ID,
        expect.objectContaining({ homeLatitude: 40.7128, homeLongitude: -74.006 }),
        1,
      );
    });

    it('emits v1:onboarding:turn after each turn', async () => {
      await service.handleTurn(ORG_ID, USER_ID, '127.0.0.1', {});
      expect(mockConflict.emitEntityEvent).toHaveBeenCalledWith(
        'v1:onboarding:turn',
        expect.objectContaining({ stepId: 'networkName', complete: false }),
        ORG_ID,
      );
    });

    it('clears Redis state when complete=true', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          stepId: 'speeds',
          progress: { networkName: 'Home' },
        }),
      );

      const result = await service.handleTurn(ORG_ID, USER_ID, '127.0.0.1', {
        chipChoice: 'skip',
      });

      expect(result.complete).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith(`onboarding:state:${USER_ID}`);
    });

    it('writes the durable completion marker (DB) when complete=true', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ stepId: 'speeds', progress: { networkName: 'Home' } }),
      );

      await service.handleTurn(ORG_ID, USER_ID, '127.0.0.1', {
        chipChoice: 'skip',
      });

      expect(mockUsersRepo.markOnboardingComplete).toHaveBeenCalledWith(USER_ID);
    });
  });

  describe('skip', () => {
    it('writes dismissed flag with 30-day TTL and removes state', async () => {
      await service.skip(USER_ID);
      expect(mockRedis.set).toHaveBeenCalledWith(
        `onboarding:dismissed:${USER_ID}`,
        '1',
        'EX',
        30 * 24 * 60 * 60,
      );
      expect(mockRedis.del).toHaveBeenCalledWith(`onboarding:state:${USER_ID}`);
    });
  });

  describe('isDismissedForSession', () => {
    it('returns true when the flag exists', async () => {
      mockRedis.get.mockResolvedValue('1');
      expect(await service.isDismissedForSession(USER_ID)).toBe(true);
    });

    it('returns false when the flag is missing', async () => {
      mockRedis.get.mockResolvedValue(null);
      expect(await service.isDismissedForSession(USER_ID)).toBe(false);
    });
  });
});
