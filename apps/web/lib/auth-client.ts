import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields } from 'better-auth/client/plugins';

const apiUrl =
  typeof process !== 'undefined' && process.env.EXPO_PUBLIC_API_URL
    ? process.env.EXPO_PUBLIC_API_URL
    : 'http://localhost:3000';

// Mirror the server's additionalFields config in apps/api/src/auth/better-auth.config.ts.
// inferAdditionalFields tells the client SDK that authClient.getSession().data.user
// includes these three fields, so callers can use a plain `as SessionUser` cast
// (the runtime shapes match — the cast just narrows the inferred Better Auth
// user type to our shared SessionUser interface). Keep this list in sync with
// the server config — there is no automatic cross-workspace type bridge.
export const authClient = createAuthClient({
  baseURL: apiUrl,
  fetchOptions: { credentials: 'include' },
  plugins: [
    inferAdditionalFields({
      user: {
        // input: false on all three matches the server config — signUp must
        // not accept these fields from the client (security: prevents users
        // from self-assigning tier on registration).
        tier: { type: 'string', input: false },
        homeLatitude: { type: 'number', required: false, input: false },
        homeLongitude: { type: 'number', required: false, input: false },
      },
    }),
  ],
});
