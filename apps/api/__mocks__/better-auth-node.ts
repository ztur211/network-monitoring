import { Request, Response } from 'express';

export const fromNodeHeaders = jest.fn((headers: Record<string, string | string[] | undefined>) => headers ?? {});

/**
 * Mock for toNodeHandler used in e2e tests.
 *
 * Returns a handler that:
 * - On POST sign-up/sign-in: sets a fake session cookie and responds 200.
 * - On GET get-session: returns the session JSON if the mock cookie is present.
 * - On POST sign-out: clears the cookie.
 * - All other routes: responds 404.
 *
 * The session token value is fixed so that better-auth.ts mock's getSession
 * can recognise it and return a synthetic user object.
 */
export const MOCK_SESSION_TOKEN = 'mock-session-token-for-e2e-tests';

const MOCK_USER = {
  id: 'mock-user-id-e2e',
  email: 'e2e@example.com',
  name: 'E2E User',
  emailVerified: true,
  tier: 'PERSONAL_FREE',
  homeLatitude: null,
  homeLongitude: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const MOCK_SESSION = {
  id: 'mock-session-id-e2e',
  userId: MOCK_USER.id,
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ipAddress: null,
  userAgent: null,
  token: MOCK_SESSION_TOKEN,
};

export const toNodeHandler = jest.fn(
  () => (req: Request, res: Response) => {
    const url = req.url ?? '';

    if (
      url.includes('/sign-up/email') ||
      url.includes('/sign-in/email')
    ) {
      const email = (req.body as { email?: string })?.email ?? MOCK_USER.email;
      res.setHeader(
        'Set-Cookie',
        `better-auth.session_token=${MOCK_SESSION_TOKEN}; Path=/; HttpOnly`,
      );
      res.status(200).json({ user: { ...MOCK_USER, email }, session: MOCK_SESSION });
      return;
    }

    if (url.includes('/get-session')) {
      const cookieHeader: string = (req.headers['cookie'] as string) ?? '';
      if (cookieHeader.includes(MOCK_SESSION_TOKEN)) {
        res.status(200).json({ user: MOCK_USER, session: MOCK_SESSION });
      } else {
        res.status(200).json(null);
      }
      return;
    }

    if (url.includes('/sign-out')) {
      res.setHeader(
        'Set-Cookie',
        'better-auth.session_token=; Path=/; HttpOnly; Max-Age=0',
      );
      res.status(200).json({ success: true });
      return;
    }

    res.status(404).json({ error: 'mock: unknown auth route' });
  },
);
