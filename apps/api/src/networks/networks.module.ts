import { forwardRef, Module } from '@nestjs/common';
import { ConflictResolutionModule } from '../conflict/conflict.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NetworksController } from './networks.controller';
import { NetworksRepository } from './networks.repository';
import { NetworksService } from './networks.service';

@Module({
  imports: [
    forwardRef(() => ConflictResolutionModule),
    forwardRef(() => RealtimeModule),
  ],
  controllers: [NetworksController],
  providers: [NetworksService, NetworksRepository],
  exports: [NetworksRepository, NetworksService],
})
export class NetworksModule {}
