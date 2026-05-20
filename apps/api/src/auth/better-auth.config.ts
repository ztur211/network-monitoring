import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import * as argon2 from 'argon2';
import { prisma } from '../prisma/prisma.service';

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    password: {
      hash: (password: string) => argon2.hash(password, { type: argon2.argon2id }),
      verify: ({ hash, password }: { hash: string; password: string }) =>
        argon2.verify(hash, password),
    },
    // MVP has no email service. Provide a no-op so the /forget-password endpoint
    // returns 200 regardless of whether the email exists — this matches the
    // anti-enumeration contract documented in API Design v1.0.
    sendResetPassword: async () => undefined,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  user: {
    additionalFields: {
      tier: { type: 'string', defaultValue: 'PERSONAL_FREE', input: false, returned: true },
      homeLatitude: { type: 'number', required: false, input: false, returned: true },
      homeLongitude: { type: 'number', required: false, input: false, returned: true },
    },
  },
  trustedOrigins: [process.env.FRONTEND_URL ?? 'http://localhost:8081'],
});
