import { Module } from '@nestjs/common';
import { FiberRunsController } from './fiber-runs.controller';
import { FiberRunsService } from './fiber-runs.service';
import { FiberRunsRepository } from './fiber-runs.repository';
import { ConflictResolutionModule } from '../conflict/conflict.module';
import { DevicesModule } from '../devices/devices.module';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [ConflictResolutionModule, DevicesModule, PermissionsModule],
  controllers: [FiberRunsController],
  providers: [FiberRunsService, FiberRunsRepository],
  exports: [FiberRunsRepository],
})
export class FiberRunsModule {}
