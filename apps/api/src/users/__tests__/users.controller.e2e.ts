import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/** Fixed ID that the better-auth mock returns for getSession. Keep in sync with __mocks__/better-auth.ts. */
const MOCK_USER_ID = 'mock-user-id-e2e';
const MOCK_SESSION_TOKEN = 'mock-session-token-for-e2e-tests';

/**
 * E2E tests for /api/v1/users/* endpoints.
 * Requires running test database and Redis.
 */
describe('UsersController (e2e)', () => {
  let app: INestApplication;
  let sessionCookie: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    // Seed the mock user that the better-auth mock's getSession returns.
    // The auth controller is mocked (toNodeHandler returns a stub), so sign-up
    // does not write to the DB. We must create the user row ourselves so that
    // service methods that call usersRepository.findById / update find a record.
    const prisma = app.get(PrismaService);
    await prisma.user.upsert({
      where: { id: MOCK_USER_ID },
      create: {
        id: MOCK_USER_ID,
        email: 'e2e-users-mock@example.com',
        name: 'E2E User',
        emailVerified: true,
        tier: 'PERSONAL_FREE',
      },
      update: {
        mapPreferences: {},
      },
    });

    // Call the mocked sign-up endpoint to get the session cookie.
    const signUpRes = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: 'e2e-users-mock@example.com', password: 'Password123!', name: 'E2E User' });

    const setCookie = signUpRes.headers['set-cookie'];
    const rawCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    // Supertest .set('Cookie', …) needs just the name=value pair, not the full Set-Cookie directives.
    sessionCookie = rawCookie?.split(';')[0] ?? `better-auth.session_token=${MOCK_SESSION_TOKEN}`;
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.user.deleteMany({ where: { id: MOCK_USER_ID } });
    await app.close();
  });

  describe('GET /api/v1/users/me', () => {
    it('returns 200 with UserDto for authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        email: expect.stringContaining('@example.com'),
        tier: 'PERSONAL_FREE',
      });
    });

    it('returns 401 AUTH_002 for unauthenticated request', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/users/me');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_002');
    });
  });

  describe('PATCH /api/v1/users/me', () => {
    it('returns 200 with updated UserDto', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Cookie', sessionCookie)
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated Name');
    });

    it('returns 400 GEN_001 for invalid email format', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Cookie', sessionCookie)
        .send({ email: 'not-an-email' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/users/location', () => {
    it('sets location from coordinates', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users/location')
        .set('Cookie', sessionCookie)
        .send({ latitude: 40.7128, longitude: -74.006 });

      expect(res.status).toBe(200);
      expect(res.body.data.latitude).toBeCloseTo(40.7128);
      expect(res.body.data.longitude).toBeCloseTo(-74.006);
    });

    it('returns 400 GEN_001 when neither address nor coordinates provided', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users/location')
        .set('Cookie', sessionCookie)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/users/me/preferences', () => {
    it('returns 200 with empty preferences for a fresh user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me/preferences')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ preferences: {} });
    });

    it('returns 401 AUTH_002 for unauthenticated request', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/users/me/preferences');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_002');
    });
  });

  describe('PUT /api/v1/users/me/preferences', () => {
    it('round-trips: PUT then GET returns what was written', async () => {
      const payload = {
        buildingsVisible: false,
        mapZoom: 17,
        mapCenter: [-73.985, 40.748] as [number, number],
        selectedFloor: 2,
        floorDisplayMode: 'single' as const,
      };
      const putRes = await request(app.getHttpServer())
        .put('/api/v1/users/me/preferences')
        .set('Cookie', sessionCookie)
        .send(payload);

      expect(putRes.status).toBe(200);

      const getRes = await request(app.getHttpServer())
        .get('/api/v1/users/me/preferences')
        .set('Cookie', sessionCookie);

      expect(getRes.body.data.preferences).toEqual(payload);
    });

    it('PUT replaces prior preferences entirely (not merge)', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/users/me/preferences')
        .set('Cookie', sessionCookie)
        .send({ buildingsVisible: false, mapZoom: 17 });

      await request(app.getHttpServer())
        .put('/api/v1/users/me/preferences')
        .set('Cookie', sessionCookie)
        .send({ mapZoom: 10 });

      const getRes = await request(app.getHttpServer())
        .get('/api/v1/users/me/preferences')
        .set('Cookie', sessionCookie);

      expect(getRes.body.data.preferences).toEqual({ mapZoom: 10 });
    });

    it('returns 400 for invalid mapZoom (string instead of number)', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/users/me/preferences')
        .set('Cookie', sessionCookie)
        .send({ mapZoom: 'not-a-number' });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid floorDisplayMode (unknown enum value)', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/users/me/preferences')
        .set('Cookie', sessionCookie)
        .send({ floorDisplayMode: 'invalid' });

      expect(res.status).toBe(400);
    });

    it('returns 400 for unknown extra field (whitelist mode)', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/users/me/preferences')
        .set('Cookie', sessionCookie)
        .send({ buildingsVisible: true, hackerField: 'evil' });

      expect(res.status).toBe(400);
    });

    it('returns 401 AUTH_002 for unauthenticated PUT', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/users/me/preferences')
        .send({ buildingsVisible: true });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_002');
    });
  });
});
