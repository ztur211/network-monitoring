import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';
import { AI_PROVIDER_TOKEN } from '../adapters/ai-provider.interface';

// AI messaging is WebSocket-only; the HTTP surface is just GET /usage and
// DELETE /conversation/:id. The adapter is mocked only so AppModule boots
// without reaching for a real model server.
const mockAdapter = {
  complete: jest.fn(),
  stream: jest.fn(),
};

describe('AiController (e2e)', () => {
  let app: INestApplication;
  let sessionCookie: string;
  let testUserId: string;
  const testEmail = `e2e-ai-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AI_PROVIDER_TOKEN)
      .useValue(mockAdapter)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    const signUpRes = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: testEmail, password: 'Password123!', name: 'AI E2E User' });

    const setCookie = signUpRes.headers['set-cookie'];
    sessionCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;

    const user = await app.get(PrismaService).user.findUnique({ where: { email: testEmail } });
    testUserId = user!.id;
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await app.close();
  });

  describe('GET /api/v1/ai/usage', () => {
    it('returns 200 with usage data for authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/ai/usage')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.hourlyUsed).toBe('number');
      expect(typeof res.body.data.hourlyLimit).toBe('number');
      expect(typeof res.body.data.monthlyTokenBudget).toBe('number');
      expect(res.body.data.resetsAt).toBeTruthy();
    });

    it('returns 401 AUTH_002 without authentication', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/ai/usage');
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/v1/ai/conversation/:conversationId', () => {
    it('returns 200 after deleting an existing (seeded) conversation', async () => {
      // No HTTP message endpoint to create one, so seed history directly under
      // the user-scoped key via ConversationService.
      const convId = 'a1111111-1111-4111-8111-111111111111';
      await app.get(ConversationService).appendMessages(testUserId, convId, 'q', 'a');

      const deleteRes = await request(app.getHttpServer())
        .delete(`/api/v1/ai/conversation/${convId}`)
        .set('Cookie', sessionCookie);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);
    });

    it('returns 404 GEN_002 for a conversation that does not exist', async () => {
      const res = await request(app.getHttpServer())
        .delete('/api/v1/ai/conversation/00000000-0000-4000-8000-000000000000')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('GEN_002');
    });

    it('returns 401 AUTH_002 without authentication', async () => {
      const res = await request(app.getHttpServer()).delete('/api/v1/ai/conversation/some-id');
      expect(res.status).toBe(401);
    });
  });
});
