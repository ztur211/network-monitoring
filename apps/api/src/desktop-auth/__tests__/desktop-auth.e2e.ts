import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { createHash, randomBytes } from 'node:crypto';
import { AppModule } from '../../app.module';

const base64url = (b: Buffer) => b.toString('base64url');

/**
 * E2E tests for the desktop-auth PKCE flow.
 * Requires running test database (port 5433) and Redis (port 6380).
 *
 * Flow under test:
 *   Desktop opens browser → GET /authorize (with PKCE challenge + redirect_uri)
 *   → If not logged in: redirect to /login?returnTo=...
 *   → If logged in: redirect to nodescope://auth/callback?code=...&state=...
 *   → Desktop calls POST /token with code + verifier → receives bearer token
 *   → Bearer token authenticates subsequent API calls
 *   → Desktop calls POST /revoke to end session (requires valid bearer token)
 */
describe('DesktopAuth (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;

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
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Happy path: full PKCE round-trip
  // ──────────────────────────────────────────────────────────────────────────

  it('authorize → (logged-in) code → token round-trips a usable bearer token', async () => {
    // 1. Sign up and capture the session cookie
    const signup = await request(server)
      .post('/api/auth/sign-up/email')
      .send({ email: `da-${Date.now()}@x.io`, password: 'Password123!', name: 'D' })
      .expect(200);
    const rawCookie = signup.headers['set-cookie'] as string | string[];
    const cookie = Array.isArray(rawCookie) ? rawCookie : [rawCookie];

    // 2. Construct a PKCE pair
    const verifier = base64url(randomBytes(32));
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    // 3. Call /authorize while logged in — should redirect to desktop scheme
    const authz = await request(server)
      .get(
        `/api/v1/desktop-auth/authorize?code_challenge=${challenge}&state=xyz&redirect_uri=${encodeURIComponent('nodescope://auth/callback')}`,
      )
      .set('Cookie', cookie)
      .expect(302);

    const location = authz.headers.location as string;
    expect(location).toMatch(/^nodescope:\/\/auth\/callback\?code=/);

    const locationUrl = new URL(location);
    const code = locationUrl.searchParams.get('code')!;
    expect(code).toBeTruthy();
    expect(locationUrl.searchParams.get('state')).toBe('xyz');

    // 4. Exchange code + verifier for a bearer token
    const tokRes = await request(server)
      .post('/api/v1/desktop-auth/token')
      .send({ code, code_verifier: verifier })
      .expect(201);

    const token = tokRes.body.data.token as string;
    expect(token).toBeTruthy();

    // 5. The bearer token must authenticate a protected endpoint
    const meRes = await request(server)
      .get('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${token}`);
    // Not 401 — authenticated. May be 200 (org found) or 404 (not yet provisioned).
    expect(meRes.status).not.toBe(401);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // No-session redirect
  // ──────────────────────────────────────────────────────────────────────────

  it('authorize without a session redirects to the web login with returnTo', async () => {
    const r = await request(server)
      .get(
        `/api/v1/desktop-auth/authorize?code_challenge=c&state=s&redirect_uri=${encodeURIComponent('nodescope://auth/callback')}`,
      )
      .expect(302);

    const location = r.headers.location as string;
    expect(location).toContain('/login?returnTo=');
    // The returnTo value must encode the original /authorize path so the browser
    // completes the flow after login.
    expect(location).toContain('desktop-auth%2Fauthorize');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Bad redirect_uri — DAUTH_001
  // ──────────────────────────────────────────────────────────────────────────

  it('rejects a bad redirect_uri (DAUTH_001)', async () => {
    const r = await request(server)
      .get(
        `/api/v1/desktop-auth/authorize?code_challenge=c&state=s&redirect_uri=${encodeURIComponent('http://evil.example')}`,
      )
      .expect(400);

    expect(r.body.error.code).toBe('DAUTH_001');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PKCE verification failures — DAUTH_003 + DAUTH_002
  // ──────────────────────────────────────────────────────────────────────────

  it('token rejects a wrong verifier (DAUTH_003) and a reused code (DAUTH_002)', async () => {
    // Set up a logged-in session to obtain a real code
    const signup = await request(server)
      .post('/api/auth/sign-up/email')
      .send({ email: `da-pkce-${Date.now()}@x.io`, password: 'Password123!', name: 'E' })
      .expect(200);
    const rawCookie2 = signup.headers['set-cookie'] as string | string[];
    const cookie = Array.isArray(rawCookie2) ? rawCookie2 : [rawCookie2];

    const verifier = base64url(randomBytes(32));
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    const authz = await request(server)
      .get(
        `/api/v1/desktop-auth/authorize?code_challenge=${challenge}&state=abc&redirect_uri=${encodeURIComponent('nodescope://auth/callback')}`,
      )
      .set('Cookie', cookie)
      .expect(302);

    const code = new URL(authz.headers.location as string).searchParams.get('code')!;
    expect(code).toBeTruthy();

    // Attempt 1: wrong verifier — the service deletes the code before verifying,
    // so this should return DAUTH_003.
    const bad = await request(server)
      .post('/api/v1/desktop-auth/token')
      .send({ code, code_verifier: 'wrong-verifier-that-does-not-match' })
      .expect(400);
    expect(bad.body.error.code).toBe('DAUTH_003');

    // Attempt 2: correct verifier on the now-burned code — DAUTH_002.
    const reused = await request(server)
      .post('/api/v1/desktop-auth/token')
      .send({ code, code_verifier: verifier })
      .expect(400);
    expect(reused.body.error.code).toBe('DAUTH_002');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Revoke endpoint — requires auth (not @Public)
  // ──────────────────────────────────────────────────────────────────────────

  it('revoke without a bearer token returns 401', async () => {
    await request(server).post('/api/v1/desktop-auth/revoke').expect(401);
  });

  it('revoke with a valid bearer token returns 204', async () => {
    // Sign up and grab the set-auth-token header (bearer plugin)
    const signup = await request(server)
      .post('/api/auth/sign-up/email')
      .send({ email: `da-rev-${Date.now()}@x.io`, password: 'Password123!', name: 'R' })
      .expect(200);
    const token = signup.headers['set-auth-token'] as string;
    expect(token).toBeTruthy();

    await request(server)
      .post('/api/v1/desktop-auth/revoke')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // DTO validation — blank fields rejected at controller layer
  // ──────────────────────────────────────────────────────────────────────────

  it('token rejects empty strings in DTO (ValidationPipe)', async () => {
    const r = await request(server)
      .post('/api/v1/desktop-auth/token')
      .send({ code: '', code_verifier: '' })
      .expect(400);
    expect(r.body.success).toBe(false);
  });
});
