import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { AI_PROVIDER_TOKEN } from '../adapters/ai-provider.interface';

const mockAdapter = {
  complete: jest.fn().mockResolvedValue({
    content: 'You have 3 documented devices.',
    inputTokens: 200,
    outputTokens: 30,
  }),
  stream: jest.fn(),
};

describe('AiController (e2e)', () => {
  let app: INestApplication;
  let sessionCookie: string;

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
      .send({
        email: `e2e-ai-${Date.now()}@example.com`,
        password: 'Password123!',
        name: 'AI E2E User',
      });

    const setCookie = signUpRes.headers['set-cookie'];
    sessionCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAdapter.complete.mockResolvedValue({
      content: 'You have 3 documented devices.',
      inputTokens: 200,
      outputTokens: 30,
    });
  });

  describe('POST /api/v1/ai/message', () => {
    it('returns 200 with AI response for authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/ai/message')
        .set('Cookie', sessionCookie)
        .send({ content: 'How many devices do I have?' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBeTruthy();
      expect(res.body.data.conversationId).toBeTruthy();
      expect(typeof res.body.data.tokensUsed).toBe('number');
    });

    it('returns 401 AUTH_002 without authentication', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/ai/message')
        .send({ content: 'Hello' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_002');
    });

    it('returns 400 GEN_001 when content is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/ai/message')
        .set('Cookie', sessionCookie)
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 400 GEN_001 when content exceeds 2000 characters', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/ai/message')
        .set('Cookie', sessionCookie)
        .send({ content: 'x'.repeat(2001) });

      expect(res.status).toBe(400);
    });

    it('continues existing conversation when conversationId is provided', async () => {
      const firstRes = await request(app.getHttpServer())
        .post('/api/v1/ai/message')
        .set('Cookie', sessionCookie)
        .send({ content: 'First message' });

      const convId = firstRes.body.data.conversationId;

      const secondRes = await request(app.getHttpServer())
        .post('/api/v1/ai/message')
        .set('Cookie', sessionCookie)
        .send({ content: 'Second message', conversationId: convId });

      expect(secondRes.status).toBe(200);
      expect(secondRes.body.data.conversationId).toBe(convId);
    });
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
    it('returns 200 after deleting a conversation', async () => {
      const msgRes = await request(app.getHttpServer())
        .post('/api/v1/ai/message')
        .set('Cookie', sessionCookie)
        .send({ content: 'Start a conversation' });

      const convId = msgRes.body.data.conversationId;

      const deleteRes = await request(app.getHttpServer())
        .delete(`/api/v1/ai/conversation/${convId}`)
        .set('Cookie', sessionCookie);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);
    });

    it('returns 401 AUTH_002 without authentication', async () => {
      const res = await request(app.getHttpServer())
        .delete('/api/v1/ai/conversation/some-id');
      expect(res.status).toBe(401);
    });
  });
});
