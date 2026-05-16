import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from '../users.service';
import { UsersRepository } from '../users.repository';
import { NodeScopeException } from '../../common/filters/global-exception.filter';
import { GEOCODING_PROVIDER } from '../../map/geocoding/geocoding.interface';

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  emailVerified: false,
  name: 'Test User',
  image: null,
  tier: 'PERSONAL_FREE',
  homeLatitude: null,
  homeLongitude: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const mockRepository: jest.Mocked<UsersRepository> = {
  findById: jest.fn(),
  update: jest.fn(),
  updateLocation: jest.fn(),
  existsByEmail: jest.fn(),
} as unknown as jest.Mocked<UsersRepository>;

const mockGeocoding = {
  geocode: jest.fn(),
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: mockRepository },
        { provide: GEOCODING_PROVIDER, useValue: mockGeocoding },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  describe('getMe', () => {
    it('returns UserDto for existing user', async () => {
      mockRepository.findById.mockResolvedValue(mockUser);

      const result = await service.getMe('user-1');

      expect(result.id).toBe('user-1');
      expect(result.email).toBe('test@example.com');
      expect(result.tier).toBe('PERSONAL_FREE');
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(service.getMe('missing')).rejects.toThrow(NodeScopeException);
    });
  });

  describe('updateMe', () => {
    it('updates name successfully', async () => {
      const updated = { ...mockUser, name: 'New Name' };
      mockRepository.update.mockResolvedValue(updated);

      const result = await service.updateMe('user-1', { name: 'New Name' });

      expect(result.name).toBe('New Name');
      expect(mockRepository.update).toHaveBeenCalledWith('user-1', { name: 'New Name' });
    });

    it('throws AUTH_005 when new email is already taken', async () => {
      mockRepository.existsByEmail.mockResolvedValue(true);

      await expect(
        service.updateMe('user-1', { email: 'taken@example.com' }),
      ).rejects.toThrow(NodeScopeException);
    });

    it('updates email when not taken', async () => {
      const updated = { ...mockUser, email: 'new@example.com' };
      mockRepository.existsByEmail.mockResolvedValue(false);
      mockRepository.update.mockResolvedValue(updated);

      const result = await service.updateMe('user-1', { email: 'new@example.com' });

      expect(result.email).toBe('new@example.com');
    });
  });

  describe('setLocation', () => {
    it('sets location from coordinates directly', async () => {
      const updated = { ...mockUser, homeLatitude: 40.7128, homeLongitude: -74.006 };
      mockRepository.updateLocation.mockResolvedValue(updated);

      const result = await service.setLocation('user-1', {
        latitude: 40.7128,
        longitude: -74.006,
      });

      expect(result.latitude).toBe(40.7128);
      expect(result.longitude).toBe(-74.006);
      expect(mockRepository.updateLocation).toHaveBeenCalledWith('user-1', 40.7128, -74.006);
    });

    it('geocodes address and sets location', async () => {
      mockGeocoding.geocode.mockResolvedValue({
        latitude: 51.5074,
        longitude: -0.1278,
        displayName: 'London, UK',
      });
      mockRepository.updateLocation.mockResolvedValue({
        ...mockUser,
        homeLatitude: 51.5074,
        homeLongitude: -0.1278,
      });

      const result = await service.setLocation('user-1', { address: 'London' });

      expect(result.latitude).toBeCloseTo(51.5074);
      expect(result.address).toBe('London, UK');
      expect(mockGeocoding.geocode).toHaveBeenCalledWith('London');
    });

    it('throws MAP_001 when geocoding returns null', async () => {
      mockGeocoding.geocode.mockResolvedValue(null);

      await expect(service.setLocation('user-1', { address: 'Nowhere' })).rejects.toThrow(NodeScopeException);
    });

    it('throws GEN_001 when neither address nor coordinates provided', async () => {
      await expect(service.setLocation('user-1', {})).rejects.toThrow(NodeScopeException);
    });
  });
});
