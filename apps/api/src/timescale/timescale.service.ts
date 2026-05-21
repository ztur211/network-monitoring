import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TimescaleService implements OnModuleInit {
  private readonly logger = new Logger(TimescaleService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureExtension();
    await this.initializeHypertable();
    await this.initializePolicies();
  }

  private async ensureExtension(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS timescaledb');
    } catch (error) {
      this.logger.fatal(
        { error },
        'Failed to create TimescaleDB extension — DB role lacks privileges or image lacks the extension',
      );
      process.exit(1);
    }
  }

  private async initializeHypertable(): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        SELECT create_hypertable('"DeviceMetric"', 'time',
          chunk_time_interval => INTERVAL '1 week',
          if_not_exists => TRUE)
      `;
      this.logger.log('DeviceMetric hypertable ready');
    } catch (error) {
      this.logger.fatal(
        { error },
        'Failed to initialize DeviceMetric hypertable — application cannot function without TimescaleDB',
      );
      process.exit(1);
    }
  }

  private async initializePolicies(): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        ALTER TABLE "DeviceMetric" SET (
          timescaledb.compress,
          timescaledb.compress_segmentby = 'userId'
        )
      `;
      await this.prisma.$executeRaw`
        SELECT add_compression_policy('"DeviceMetric"',
          INTERVAL '7 days',
          if_not_exists => TRUE)
      `;
      await this.prisma.$executeRaw`
        SELECT add_retention_policy('"DeviceMetric"',
          INTERVAL '30 days',
          if_not_exists => TRUE)
      `;
      this.logger.log('TimescaleDB compression and retention policies ready');
    } catch (error) {
      this.logger.warn({ error }, 'Failed to set TimescaleDB compression or retention policies — continuing');
    }
  }
}
