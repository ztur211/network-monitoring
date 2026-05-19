/** Keep in sync with better-auth-node.ts mock. */
const MOCK_SESSION_TOKEN = 'mock-session-token-for-e2e-tests';

const MOCK_USER = {
  id: 'mock-user-id-e2e',
  email: 'e2e@example.com',
  name: 'E2E User',
  emailVerified: true,
  tier: 'PERSONAL_FREE',
  homeLatitude: null,
  homeLongitude: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MOCK_SESSION_OBJ = {
  id: 'mock-session-id-e2e',
  userId: MOCK_USER.id,
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  createdAt: new Date(),
  updatedAt: new Date(),
  ipAddress: null,
  userAgent: null,
  token: MOCK_SESSION_TOKEN,
};

export const betterAuth = jest.fn(() => ({
  handler: jest.fn(),
  api: {
    getSession: jest.fn().mockImplementation(
      (opts: { headers: Record<string, string | string[]> }) => {
        const cookieHeader = opts?.headers?.['cookie'] ?? '';
        const cookie = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
        if (typeof cookie === 'string' && cookie.includes(MOCK_SESSION_TOKEN)) {
          return Promise.resolve({ user: MOCK_USER, session: MOCK_SESSION_OBJ });
        }
        return Promise.resolve(null);
      },
    ),
    signUpEmail: jest.fn(),
  },
  $Infer: { Session: { user: {}, session: {} } },
}));
