import { forwardRef, Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { DataSourcesModule } from '../data-sources/data-sources.module';
import { AiModule } from '../ai/ai.module';
import { NetworksModule } from '../networks/networks.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { RealtimeGateway } from './realtime.gateway';
import { REALTIME_SERVICE } from './realtime.types';

@Module({
  imports: [
    RedisModule,
    DataSourcesModule,
    AiModule,
    OrganizationsModule,
    PermissionsModule,
    forwardRef(() => NetworksModule),
  ],
  providers: [
    RealtimeGateway,
    { provide: REALTIME_SERVICE, useExisting: RealtimeGateway },
  ],
  exports: [REALTIME_SERVICE, RealtimeGateway],
})
export class RealtimeModule {}
