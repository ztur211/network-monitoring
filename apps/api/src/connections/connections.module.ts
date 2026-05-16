import { Module } from '@nestjs/common';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';
import { ConnectionsRepository } from './connections.repository';
import { ConflictResolutionModule } from '../conflict/conflict.module';
import { DevicesModule } from '../devices/devices.module';

@Module({
  imports: [ConflictResolutionModule, DevicesModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService, ConnectionsRepository],
  exports: [ConnectionsRepository],
})
export class ConnectionsModule {}
