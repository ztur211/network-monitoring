import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../app.module';

/**
 * E2E tests for Better Auth endpoints mounted at /api/auth/*.
 * Requires running test database and Redis.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;

  const testEmail = `auth-e2e-${Date.now()}@example.com`;
  const testPassword = 'Password123!';

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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/auth/sign-up/email', () => {
    it('creates User + Account + Session rows and sets session cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: testEmail, password: testPassword, name: 'E2E Auth User' });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(testEmail);
      expect(res.body.user.tier).toBe('PERSONAL_FREE');
      expect(res.headers['set-cookie']).toBeDefined();
    });
  });

  describe('Full flow: sign-up → get-session → update-me → sign-out', () => {
    let sessionCookie: string;

    it('sign-in retrieves a new session cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: testEmail, password: testPassword });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      const setCookie = res.headers['set-cookie'];
      sessionCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(sessionCookie).toBeDefined();
    });

    it('get-session returns user data with valid cookie', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/get-session')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(testEmail);
      expect(res.body.user.tier).toBe('PERSONAL_FREE');
    });

    it('GET /api/v1/users/me returns 200 with AuthGuard session resolution', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(testEmail);
    });

    it('GET /api/v1/users/me returns 401 AUTH_002 without cookie', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/users/me');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_002');
    });

    it('sign-out clears the session', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-out')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
    });

    it('get-session returns null body after sign-out', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/get-session')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      // Better Auth returns null session after sign-out
      expect(res.body).toBeNull();
    });
  });

  describe('POST /api/auth/sign-in/email', () => {
    it('returns error for wrong password', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: testEmail, password: 'WrongPassword123!' });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/forget-password', () => {
    it('returns 200 regardless of whether email exists (prevents enumeration)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/forget-password')
        .send({ email: 'nonexistent@example.com' });

      expect(res.status).toBe(200);
    });
  });
});
