import { Module } from '@nestjs/common';
import { CircuitsController } from './circuits.controller';
import { CircuitsService } from './circuits.service';
import { CircuitsRepository } from './circuits.repository';
import { ConflictResolutionModule } from '../conflict/conflict.module';
import { DevicesModule } from '../devices/devices.module';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';

@Module({
  imports: [ConflictResolutionModule, DevicesModule],
  controllers: [CircuitsController],
  providers: [CircuitsService, CircuitsRepository, IdempotencyInterceptor],
  exports: [CircuitsRepository],
})
export class CircuitsModule {}
