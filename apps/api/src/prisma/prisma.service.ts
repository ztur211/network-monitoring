import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Singleton for use outside NestJS DI (better-auth.config.ts, seed.ts)
export const prisma = new PrismaClient();

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.$disconnect(), prisma.$disconnect()]);
  }
}
