import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';

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

    // Sign up and capture session cookie
    const signUpRes = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: `e2e-users-${Date.now()}@example.com`, password: 'Password123!', name: 'E2E User' });

    const setCookie = signUpRes.headers['set-cookie'];
    sessionCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  });

  afterAll(async () => {
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
});
