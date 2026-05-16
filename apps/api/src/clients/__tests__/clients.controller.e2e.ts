import * as request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';

// E2E tests — require test DB and running services
// Run with: npm run test:e2e --workspace=apps/api

describe('GET /api/v1/clients', () => {
  let app: INestApplication;
  let sessionCookie: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('when not authenticated', () => {
    it('returns 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/clients').expect(401);
    });
  });

  describe('when authenticated', () => {
    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: 'dev@nodescope.test', password: process.env.SEED_PASSWORD });
      sessionCookie = res.headers['set-cookie']?.[0] ?? '';
    });

    it('returns 200 with currentDevice and agentStatus', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/clients')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.currentDevice).toBeDefined();
      expect(res.body.data.currentDevice.userAgent).toBeDefined();
      expect(res.body.data.agentStatus.available).toBe(false);
      expect(typeof res.body.data.agentStatus.message).toBe('string');
    });

    it('agentStatus.available is always false in MVP', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/clients')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(res.body.data.agentStatus.available).toBe(false);
    });
  });
});
