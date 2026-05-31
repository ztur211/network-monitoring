import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersRepository } from '../users.repository';

/**
 * Integration tests — run against the real test database.
 * Requires docker compose -f docker-compose.test.yml up to be running.
 * TEST_DATABASE_URL must be set in the environment.
 */
describe('UsersRepository (integration)', () => {
  let repository: UsersRepository;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersRepository, PrismaService],
    }).compile();

    repository = module.get<UsersRepository>(UsersRepository);
    prisma = module.get<PrismaService>(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  let testUserId: string;

  beforeEach(async () => {
    // Insert a test user directly — Better Auth seed would be too heavy here
    const user = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        emailVerified: false,
        name: 'Repo Test User',
      },
    });
    testUserId = user.id;
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: testUserId } });
  });

  describe('findById', () => {
    it('returns user when found', async () => {
      const result = await repository.findById(testUserId);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(testUserId);
    });

    it('returns null when user does not exist', async () => {
      const result = await repository.findById('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('updates the name field', async () => {
      const updated = await repository.update(testUserId, { name: 'Updated Name' });
      expect(updated.name).toBe('Updated Name');
    });
  });

  describe('updateLocation', () => {
    it('sets homeLatitude and homeLongitude', async () => {
      const updated = await repository.updateLocation(testUserId, 51.5074, -0.1278);
      expect(updated.homeLatitude).toBeCloseTo(51.5074);
      expect(updated.homeLongitude).toBeCloseTo(-0.1278);
    });
  });

  describe('existsByEmail', () => {
    it('returns true when email is taken by another user', async () => {
      const user = await repository.findById(testUserId);
      const exists = await repository.existsByEmail(user!.email, 'other-user-id');
      expect(exists).toBe(true);
    });

    it('returns false when email belongs to the same user', async () => {
      const user = await repository.findById(testUserId);
      const exists = await repository.existsByEmail(user!.email, testUserId);
      expect(exists).toBe(false);
    });
  });

  describe('getPreferences', () => {
    it('returns empty object by default for a fresh user', async () => {
      const prefs = await repository.getPreferences(testUserId);
      expect(prefs).toEqual({});
    });

    it('returns the stored preferences object', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { mapPreferences: { buildingsVisible: false, mapZoom: 15 } as object },
      });
      const prefs = await repository.getPreferences(testUserId);
      expect(prefs).toEqual({ buildingsVisible: false, mapZoom: 15 });
    });

    it('returns empty object for an unknown user (no throw)', async () => {
      const prefs = await repository.getPreferences('00000000-0000-0000-0000-000000000000');
      expect(prefs).toEqual({});
    });
  });

  describe('updatePreferences', () => {
    it('writes the preferences object', async () => {
      await repository.updatePreferences(testUserId, {
        buildingsVisible: true,
        mapZoom: 18,
      });
      const fresh = await prisma.user.findUnique({ where: { id: testUserId } });
      expect(fresh?.mapPreferences).toEqual({ buildingsVisible: true, mapZoom: 18 });
    });

    it('overwrites prior preferences entirely (replace semantics, not merge)', async () => {
      await repository.updatePreferences(testUserId, { buildingsVisible: false });
      await repository.updatePreferences(testUserId, { mapZoom: 10 });
      const fresh = await prisma.user.findUnique({ where: { id: testUserId } });
      expect(fresh?.mapPreferences).toEqual({ mapZoom: 10 });
    });

    it('does not modify other User fields', async () => {
      const before = await prisma.user.findUnique({ where: { id: testUserId } });
      await repository.updatePreferences(testUserId, { mapZoom: 12 });
      const after = await prisma.user.findUnique({ where: { id: testUserId } });
      expect(after?.name).toBe(before?.name);
      expect(after?.email).toBe(before?.email);
      expect(after?.tier).toBe(before?.tier);
    });
  });

  describe('onboarding completion marker', () => {
    it('isOnboardingComplete is false for a fresh user', async () => {
      expect(await repository.isOnboardingComplete(testUserId)).toBe(false);
    });

    it('markOnboardingComplete sets the durable timestamp and flips isOnboardingComplete', async () => {
      await repository.markOnboardingComplete(testUserId);

      expect(await repository.isOnboardingComplete(testUserId)).toBe(true);
      const fresh = await prisma.user.findUnique({ where: { id: testUserId } });
      expect(fresh?.onboardingCompletedAt).toBeInstanceOf(Date);
    });

    it('isOnboardingComplete is false for an unknown user', async () => {
      expect(
        await repository.isOnboardingComplete('00000000-0000-0000-0000-000000000000'),
      ).toBe(false);
    });
  });
});
