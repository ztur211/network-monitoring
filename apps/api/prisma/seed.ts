import { PrismaClient } from '@prisma/client';
import { auth } from '../src/auth/better-auth.config';

const prisma = new PrismaClient();

async function main() {
  const password = process.env.SEED_PASSWORD;
  if (!password) throw new Error('SEED_PASSWORD env var is required');

  await auth.api.signUpEmail({
    body: {
      email: 'dev@nodescope.io',
      password,
      name: 'Dev User',
    },
  });

  console.log('Seed complete: dev@nodescope.io created');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
