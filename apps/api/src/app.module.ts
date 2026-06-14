import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { HealthModule } from './health/health.module';
import { BandwidthModule } from './bandwidth/bandwidth.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { TimescaleModule } from './timescale/timescale.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/guards/auth.guard';
import { TierGuard } from './auth/guards/tier.guard';
import { RoleGuard } from './auth/guards/role.guard';
import { UsersModule } from './users/users.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TiersModule } from './tiers/tiers.module';
import { ConflictResolutionModule } from './conflict/conflict.module';
import { DevicesModule } from './devices/devices.module';
import { FiberRunsModule } from './fiber-runs/fiber-runs.module';
import { ConnectionsModule } from './connections/connections.module';
import { CircuitsModule } from './circuits/circuits.module';
import { MapModule } from './map/map.module';
import { RealtimeModule } from './realtime/realtime.module';
import { DataSourcesModule } from './data-sources/data-sources.module';
import { ClientsModule } from './clients/clients.module';
import { AiModule } from './ai/ai.module';
import { NetworksModule } from './networks/networks.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { OrgContextGuard } from './organizations/guards/org-context.guard';
import { OrgRoleGuard } from './organizations/guards/org-role.guard';
import { AuditModule } from './audit/audit.module';
import { PropertiesModule } from './properties/properties.module';
import { PermissionsModule } from './permissions/permissions.module';
import { AuditContextMiddleware } from './audit/audit-context.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty' }
            : undefined,
      },
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60 * 1000,
        limit: process.env.NODE_ENV === 'production' ? 100 : 2000,
      },
      {
        name: 'auth',
        ttl: 15 * 60 * 1000,
        limit: process.env.NODE_ENV === 'production' ? 5 : 200,
      },
    ]),
    PrismaModule,
    RedisModule,
    TimescaleModule,
    HealthModule,
    BandwidthModule,
    AuthModule,
    MapModule,
    UsersModule,
    TiersModule,
    ConflictResolutionModule,
    DevicesModule,
    FiberRunsModule,
    ConnectionsModule,
    CircuitsModule,
    DataSourcesModule,
    RealtimeModule,
    ClientsModule,
    AiModule,
    NetworksModule,
    OnboardingModule,
    OrganizationsModule,
    AuditModule,
    PropertiesModule,
    PermissionsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: OrgContextGuard },
    { provide: APP_GUARD, useClass: OrgRoleGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: TierGuard },
    { provide: APP_GUARD, useClass: RoleGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuditContextMiddleware).forRoutes('*');
  }
}
