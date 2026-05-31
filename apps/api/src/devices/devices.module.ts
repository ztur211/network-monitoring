import { forwardRef, Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DevicesRepository } from './devices.repository';
import { TiersModule } from '../tiers/tiers.module';
import { ConflictResolutionModule } from '../conflict/conflict.module';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';

@Module({
  imports: [TiersModule, forwardRef(() => ConflictResolutionModule)],
  controllers: [DevicesController],
  providers: [DevicesService, DevicesRepository, IdempotencyInterceptor],
  exports: [DevicesService, DevicesRepository],
})
export class DevicesModule {}
