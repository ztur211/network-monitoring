# Spec 2 Phase A — `@nodescope/client` + Server Desktop-Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two non-Electron foundations the desktop app needs: a framework-agnostic `@nodescope/client` package (REST + realtime, token-injected) and the server-side `/v1/desktop-auth/{authorize,token,revoke}` endpoints (system-browser OAuth + PKCE + one-time code → Better Auth session token), with the Better Auth **bearer plugin** enabled so that token works as `Authorization: Bearer`.

**Architecture:** `@nodescope/client` mirrors `@nodescope/shared` (plain TS, `tsc` build) + Vitest, with `createRestClient({ baseUrl, getToken })` and `createRealtimeClient({ baseUrl, getToken })`. The desktop-auth flow reuses the **existing web login UI** (the API's `authorize` redirects there with a `returnTo`); on a valid Better Auth session it mints a short-lived **one-time code** (stored in Redis, bound to the PKCE challenge + the browser session's token) and redirects to `nodescope://`. The `token` endpoint exchanges `code`+`verifier` for that session token. Enabling Better Auth's `bearer()` plugin makes the existing `AuthGuard` accept the token on every API route — no per-route change.

**Tech Stack:** TypeScript, Vitest (client pkg), NestJS 11 + Better Auth `^1.0.0` + Redis (api), Jest (api e2e), Node `crypto` (PKCE).

**Depends on:** F1a (Better Auth at `/api/auth/*`, `AuthGuard` via `auth.api.getSession`, `@Public()`, `RedisService`, `GET /v1/organizations/me`), F2 (`GET /v1/properties`), Spec 1 (`GET /v1/buildings/:propertyId/model[/active/file]`), `@nodescope/shared` (DTOs, `WS_EVENTS`), the existing web login (`apps/web/app/(auth)/login.tsx`). Spec: `2026-06-09-spec2-desktop-shell-design.md` (§5, §6, §10).

---

## File Structure

**Create — `@nodescope/client`:**
- `packages/client/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/client/src/index.ts` (barrel), `rest-client.ts`, `realtime-client.ts`, `api-error.ts`
- `packages/client/src/__tests__/rest-client.spec.ts`, `realtime-client.spec.ts`

**Create — server desktop-auth (api):**
- `apps/api/src/desktop-auth/desktop-auth.controller.ts`, `desktop-auth.service.ts`, `desktop-auth.module.ts`
- `apps/api/src/desktop-auth/__tests__/desktop-auth.service.spec.ts`, `desktop-auth.e2e.ts`

**Modify:**
- `apps/api/src/auth/better-auth.config.ts` — enable `bearer()` plugin
- `apps/api/src/app.module.ts` — import `DesktopAuthModule`
- `apps/web/app/(auth)/login.tsx` — honor a `returnTo` query param
- root `package.json` — `postinstall` also builds `packages/client`

---

## Task 1: `@nodescope/client` scaffold + REST client (Vitest TDD)

**Files:** the package scaffold; `src/rest-client.ts`, `src/api-error.ts`; test `src/__tests__/rest-client.spec.ts`.

- [ ] **Step 1: Scaffold the package.** `packages/client/package.json` (mirror `@nodescope/shared` + Vitest + deps):

```json
{
  "name": "@nodescope/client",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc", "dev": "tsc --watch", "lint": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@nodescope/shared": "*", "socket.io-client": "^4.7.5" },
  "devDependencies": { "typescript": "^5.4.0", "vitest": "^2.0.0" }
}
```

`packages/client/tsconfig.json` (copy `@nodescope/shared`'s); `packages/client/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node' } });
```
Run `npm install` at the root so the workspace links.

- [ ] **Step 2: Write the failing test** (`rest-client.spec.ts`)

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createRestClient } from '../rest-client';
import { ApiError } from '../api-error';

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body } as Response);
}

describe('createRestClient', () => {
  it('attaches the bearer token and unwraps { data }', async () => {
    const fetchSpy = mockFetch(200, { success: true, data: { id: 'org1' }, timestamp: 't' });
    vi.stubGlobal('fetch', fetchSpy);
    const client = createRestClient({ baseUrl: 'http://api', getToken: () => 'TKN' });
    const org = await client.getOrganization();
    expect(org).toEqual({ id: 'org1' });
    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Bearer TKN');
  });

  it('throws ApiError on an error envelope', async () => {
    vi.stubGlobal('fetch', mockFetch(403, { success: false, error: { code: 'ORG_003', message: 'x' } }));
    const client = createRestClient({ baseUrl: 'http://api', getToken: () => null });
    await expect(client.listProperties()).rejects.toMatchObject({ code: 'ORG_003', status: 403 });
    await expect(client.listProperties()).rejects.toBeInstanceOf(ApiError);
  });
});
```

- [ ] **Step 3: Run → FAIL.** `cd packages/client && npm test`.

- [ ] **Step 4: Implement `api-error.ts` + `rest-client.ts`**

```typescript
// api-error.ts
export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) { super(message); }
}
```

```typescript
// rest-client.ts
import type { OrganizationDto, PropertyDto, BuildingModelDto } from '@nodescope/shared';
import { ApiError } from './api-error';

export interface RestClientOptions { baseUrl: string; getToken: () => string | null | Promise<string | null>; }

export function createRestClient(opts: RestClientOptions) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await opts.getToken();
    const res = await fetch(`${opts.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      throw new ApiError(json?.error?.code ?? 'UNKNOWN', json?.error?.message ?? res.statusText, res.status);
    }
    return json.data as T;
  }
  return {
    request,
    getOrganization: () => request<OrganizationDto>('GET', '/v1/organizations/me'),
    listProperties: () => request<PropertyDto[]>('GET', '/v1/properties'),
    getBuildingModel: (propertyId: string) => request<BuildingModelDto>('GET', `/v1/buildings/${propertyId}/model`),
    /** Spec 3 uses this to fetch the active IFC bytes (auth header attached). */
    async getActiveModelFile(propertyId: string): Promise<ArrayBuffer> {
      const token = await opts.getToken();
      const res = await fetch(`${opts.baseUrl}/v1/buildings/${propertyId}/model/active/file`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new ApiError('MODEL_FETCH_FAILED', res.statusText, res.status);
      return res.arrayBuffer();
    },
  };
}
```

`src/index.ts` re-exports `createRestClient`, `createRealtimeClient` (Task 2), `ApiError`, and `export * from '@nodescope/shared'`.

- [ ] **Step 5: Run → PASS.** Commit `feat(client): @nodescope/client package + REST client`.

---

## Task 2: Realtime client (Vitest TDD)

**Files:** `src/realtime-client.ts`; test `src/__tests__/realtime-client.spec.ts`.

- [ ] **Step 1: Write the failing test** (mock `socket.io-client`)

```typescript
import { describe, it, expect, vi } from 'vitest';
const ioMock = vi.fn();
vi.mock('socket.io-client', () => ({ io: (...a: unknown[]) => ioMock(...a) }));
import { createRealtimeClient } from '../realtime-client';

describe('createRealtimeClient', () => {
  it('connects with the token in the handshake auth and registers handlers', async () => {
    const on = vi.fn(); ioMock.mockReturnValue({ on, disconnect: vi.fn() });
    const rt = createRealtimeClient({ baseUrl: 'http://api', getToken: () => 'TKN' });
    await rt.connect();
    expect(ioMock).toHaveBeenCalledWith('http://api', expect.objectContaining({ auth: { token: 'TKN' } }));
    const handler = vi.fn(); rt.on('v1:device:updated', handler);
    expect(on).toHaveBeenCalledWith('v1:device:updated', handler);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd packages/client && npm test`.

- [ ] **Step 3: Implement `realtime-client.ts`**

```typescript
import { io, type Socket } from 'socket.io-client';

export interface RealtimeClientOptions { baseUrl: string; getToken: () => string | null | Promise<string | null>; }

export function createRealtimeClient(opts: RealtimeClientOptions) {
  let socket: Socket | null = null;
  return {
    async connect(): Promise<void> {
      const token = await opts.getToken();
      socket = io(opts.baseUrl, { transports: ['websocket'], auth: { token } });
    },
    on(event: string, handler: (payload: unknown) => void): void { socket?.on(event, handler); },
    off(event: string, handler: (payload: unknown) => void): void { socket?.off(event, handler); },
    disconnect(): void { socket?.disconnect(); socket = null; },
  };
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(client): realtime client (socket.io, token handshake)`.

---

## Task 3: Enable the Better Auth bearer plugin

**Files:** Modify `apps/api/src/auth/better-auth.config.ts`; extend `apps/api/src/auth/__tests__/auth.e2e.ts`.

- [ ] **Step 1: Write the failing e2e** — a session token works as `Authorization: Bearer` on a protected route:

```typescript
it('accepts a session token as a Bearer header (bearer plugin)', async () => {
  // sign up → capture the set-cookie session; derive the token (the session cookie value / token endpoint)
  const signup = await request(server).post('/api/auth/sign-up/email')
    .send({ email: `bearer-${Date.now()}@x.io`, password: 'Password123!', name: 'B' }).expect(200);
  const token = extractSessionToken(signup); // from set-cookie or signup body
  await request(server).get('/api/v1/organizations/me').set('Authorization', `Bearer ${token}`).expect((r) => {
    expect([200, 404]).toContain(r.status); // 200 if org provisioned; not 401
  });
});
```

- [ ] **Step 2: Run → FAIL** (401 today — no bearer plugin).

- [ ] **Step 3: Enable the plugin** in `better-auth.config.ts`:

```typescript
import { bearer } from 'better-auth/plugins';
export const auth = betterAuth({
  // ...existing config...
  plugins: [bearer()],
});
```

(`AuthGuard` already calls `auth.api.getSession({ headers })`; the `bearer()` plugin makes `getSession` honor the `Authorization: Bearer <session-token>` header, so every existing protected route now accepts the token with no per-route change.)

- [ ] **Step 4: Run → PASS** (no longer 401). Confirm the full existing auth e2e still passes: `cd apps/api && npm run test:e2e -- auth`.

- [ ] **Step 5: Commit** `feat(api): enable Better Auth bearer plugin (Bearer token auth)`.

---

## Task 4: `DesktopAuthService` — PKCE + one-time code store (unit TDD)

**Files:** Create `desktop-auth.service.ts`; test `__tests__/desktop-auth.service.spec.ts`. Uses `RedisService` for the code store.

- [ ] **Step 1: Write the failing unit test** (mock `RedisService`)

```typescript
import { Test } from '@nestjs/testing';
import { createHash, randomBytes } from 'node:crypto';
import { DesktopAuthService } from '../desktop-auth.service';
import { RedisService } from '../../redis/redis.service';

const base64url = (b: Buffer) => b.toString('base64url');
const challengeFor = (verifier: string) => base64url(createHash('sha256').update(verifier).digest());

describe('DesktopAuthService', () => {
  let service: DesktopAuthService;
  const store = new Map<string, string>();
  const redis = { set: jest.fn((k, v, ..._a) => { store.set(k, v); return Promise.resolve('OK'); }),
                   get: jest.fn((k) => Promise.resolve(store.get(k) ?? null)),
                   del: jest.fn((k) => { store.delete(k); return Promise.resolve(1); }) } as any;

  beforeEach(async () => {
    store.clear(); jest.clearAllMocks();
    const ref = await Test.createTestingModule({
      providers: [DesktopAuthService, { provide: RedisService, useValue: redis }],
    }).compile();
    service = ref.get(DesktopAuthService);
  });

  it('issues a one-time code and exchanges it only with the matching verifier', async () => {
    const verifier = base64url(randomBytes(32));
    const code = await service.issueCode({ sessionToken: 'SESS', challenge: challengeFor(verifier) });
    expect(await service.exchange(code, verifier)).toBe('SESS');
    await expect(service.exchange(code, verifier)).rejects.toMatchObject({ code: 'DAUTH_002' }); // one-time: gone
  });

  it('rejects a bad verifier (DAUTH_003)', async () => {
    const code = await service.issueCode({ sessionToken: 'SESS', challenge: challengeFor('right') });
    await expect(service.exchange(code, 'wrong')).rejects.toMatchObject({ code: 'DAUTH_003' });
  });
});
```

- [ ] **Step 2: Run → FAIL.** `cd apps/api && npm run test:unit -- desktop-auth.service`.

- [ ] **Step 3: Implement `desktop-auth.service.ts`**

```typescript
import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { RedisService } from '../redis/redis.service';

const CODE_TTL_SECONDS = 120;
const key = (code: string) => `desktop-auth:code:${code}`;

@Injectable()
export class DesktopAuthService {
  constructor(private readonly redis: RedisService) {}

  async issueCode(data: { sessionToken: string; challenge: string }): Promise<string> {
    const code = randomBytes(32).toString('base64url');
    await this.redis.set(key(code), JSON.stringify(data), 'EX', CODE_TTL_SECONDS);
    return code;
  }

  async exchange(code: string, verifier: string): Promise<string> {
    const raw = await this.redis.get(key(code));
    if (!raw) throw new NodeScopeException('DAUTH_002', 'CODE_INVALID_OR_EXPIRED', HttpStatus.BAD_REQUEST);
    await this.redis.del(key(code)); // one-time
    const { sessionToken, challenge } = JSON.parse(raw) as { sessionToken: string; challenge: string };
    const expected = createHash('sha256').update(verifier).digest('base64url');
    if (expected.length !== challenge.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(challenge))) {
      throw new NodeScopeException('DAUTH_003', 'PKCE_VERIFICATION_FAILED', HttpStatus.BAD_REQUEST);
    }
    return sessionToken;
  }
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(api): DesktopAuthService (PKCE one-time-code store)`.

---

## Task 5: `DesktopAuthController` (authorize / token / revoke) + web `returnTo` + e2e

**Files:** Create `desktop-auth.controller.ts`; modify `apps/web/app/(auth)/login.tsx`; test `__tests__/desktop-auth.e2e.ts`.

- [ ] **Step 1: Implement the controller** (`authorize`/`token` are `@Public()`; `revoke` is authed)

```typescript
import { Controller, Get, Post, Body, Query, Res, HttpCode, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../auth/better-auth.config';
import { Public } from '../auth/decorators/public.decorator';
import { DesktopAuthService } from './desktop-auth.service';
import { ExchangeCodeDto } from './desktop-auth.dto';

@Controller('v1/desktop-auth')
export class DesktopAuthController {
  constructor(private readonly service: DesktopAuthService) {}

  @Get('authorize')
  @Public()
  async authorize(
    @Query('code_challenge') challenge: string,
    @Query('state') state: string,
    @Query('redirect_uri') redirectUri: string,
    @Req() req: import('express').Request,
    @Res() res: Response,
  ) {
    // Custom-scheme guard: only allow the desktop callback.
    if (redirectUri !== 'nodescope://auth/callback') return res.status(400).send('bad redirect_uri');
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) {
      const back = encodeURIComponent(req.originalUrl);
      return res.redirect(`${process.env.FRONTEND_URL ?? 'http://localhost:8081'}/login?returnTo=${back}`);
    }
    const code = await this.service.issueCode({ sessionToken: session.session.token, challenge });
    return res.redirect(`${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
  }

  @Post('token')
  @Public()
  async token(@Body() dto: ExchangeCodeDto) {
    const token = await this.service.exchange(dto.code, dto.code_verifier);
    return { success: true, data: { token }, timestamp: new Date().toISOString() };
  }

  @Post('revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Req() req: import('express').Request) {
    await auth.api.signOut({ headers: fromNodeHeaders(req.headers) }); // invalidates the bearer session
  }
}
```

`ExchangeCodeDto { @IsString() code; @IsString() code_verifier }` in `desktop-auth.dto.ts`. (`session.session.token` is the Better Auth session token; with the bearer plugin it's the value the desktop sends as `Authorization: Bearer`. Confirm the exact field name against the installed Better Auth version during execution.)

- [ ] **Step 2: Web login honors `returnTo`.** In `apps/web/app/(auth)/login.tsx`, after a successful `authClient.signIn.email`, if a `returnTo` query param is present, redirect the browser there instead of the default post-login route:

```typescript
const returnTo = new URLSearchParams(window.location.search).get('returnTo');
// after successful sign-in:
if (returnTo) { window.location.href = returnTo; return; }
```

- [ ] **Step 3: Write the e2e** (`desktop-auth.e2e.ts`) — the full PKCE flow without a browser:

```typescript
it('authorize → (logged-in) code → token round-trips a usable bearer token', async () => {
  // sign up + keep the session cookie
  const signup = await request(server).post('/api/auth/sign-up/email')
    .send({ email: `da-${Date.now()}@x.io`, password: 'Password123!', name: 'D' }).expect(200);
  const cookie = signup.headers['set-cookie'];
  const verifier = base64url(randomBytes(32));
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  // authorize with the session cookie → 302 to nodescope://auth/callback?code=...
  const authz = await request(server)
    .get(`/api/v1/desktop-auth/authorize?code_challenge=${challenge}&code_challenge_method=S256&state=xyz&redirect_uri=${encodeURIComponent('nodescope://auth/callback')}`)
    .set('Cookie', cookie).expect(302);
  const code = new URL(authz.headers.location).searchParams.get('code')!;
  // exchange
  const tok = await request(server).post('/api/v1/desktop-auth/token').send({ code, code_verifier: verifier }).expect(201);
  const token = tok.body.data.token;
  // the token authenticates as Bearer
  await request(server).get('/api/v1/organizations/me').set('Authorization', `Bearer ${token}`)
    .expect((r) => expect(r.status).not.toBe(401));
});

it('authorize without a session redirects to the web login with returnTo', async () => {
  const r = await request(server).get(`/api/v1/desktop-auth/authorize?code_challenge=c&state=s&redirect_uri=${encodeURIComponent('nodescope://auth/callback')}`).expect(302);
  expect(r.headers.location).toContain('/login?returnTo=');
});

it('token rejects a wrong verifier (DAUTH_003) and a reused code (DAUTH_002)', async () => { /* mirror Task 4 via the HTTP flow */ });
```

- [ ] **Step 4: Run → PASS.** `cd apps/api && npm run test:e2e -- desktop-auth`.

- [ ] **Step 5: Commit** `feat(api): /v1/desktop-auth authorize+token+revoke (system-browser PKCE)`.

---

## Task 6: Wire module + build wiring + register codes + phase gate

**Files:** `apps/api/src/app.module.ts`, `desktop-auth.module.ts`, root `package.json`, API Design Document.

- [ ] **Step 1: `desktop-auth.module.ts`** — `imports: [RedisModule]`, `controllers: [DesktopAuthController]`, `providers: [DesktopAuthService]`. Add `DesktopAuthModule` to `AppModule.imports`.
- [ ] **Step 2: Build the client package on install.** In root `package.json` `postinstall`, append ` && npm run build --workspace=packages/client` after the shared build.
- [ ] **Step 3: Register codes** in the API Design Document: `DAUTH_001 INVALID_REDIRECT_URI` (400), `DAUTH_002 CODE_INVALID_OR_EXPIRED` (400), `DAUTH_003 PKCE_VERIFICATION_FAILED` (400). (Add a `DAUTH_001` throw for the bad-redirect case in `authorize` instead of the bare 400.)
- [ ] **Step 4: Suites.** `cd packages/client && npm test` green; `cd apps/api && npm run test:unit && npm run test:e2e` green.
- [ ] **Step 5: Commit** `feat: wire DesktopAuthModule + build @nodescope/client; docs: register DAUTH_*`.

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** `@nodescope/client` REST + realtime, token-injected, re-exports shared (§6) ✓ Tasks 1–2; system-browser OAuth + PKCE + one-time code + session token (§5) ✓ Tasks 4–5; bearer plugin so the token works at runtime (§5) ✓ Task 3; `/v1/desktop-auth/{authorize,token,revoke}` (§5, §10) ✓ Task 5; `getActiveModelFile` for Spec 3 (§10) ✓ Task 1.
- **Deferred (correctly NOT here):** Electron app/scaffold/`safeStorage`/`nodescope://` handling + the renderer that calls `auth.login()` → Phase B; the shell UI + connectivity wiring + packaging → Phase C.
- **Login-UI decision (flagged):** `authorize` reuses the **existing web login** via `returnTo` (Task 5 Step 2) rather than a new API-hosted login page — least new surface; noted in case a dedicated desktop login page is preferred.
- **Placeholder scan:** none — concrete code/commands; `extractSessionToken`/`base64url` test helpers are specified.
- **Type consistency:** `createRestClient`/`createRealtimeClient({ baseUrl, getToken })` is the surface Phases B–C consume; `issueCode({ sessionToken, challenge })`/`exchange(code, verifier)` match controller calls; `ExchangeCodeDto { code, code_verifier }`.
- **Integration points to verify during execution:** the installed Better Auth `^1.0.0` API surface — `bearer()` import path, `auth.api.getSession` returning `session.session.token`, and `auth.api.signOut` (adapt names if the minor version differs); `RedisService.set(key, val, 'EX', ttl)` signature (it extends ioredis — confirm); that `@Public()` lets `authorize`/`token` bypass the global `AuthGuard`.
