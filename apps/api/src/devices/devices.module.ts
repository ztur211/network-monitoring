import { forwardRef, Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DevicesRepository } from './devices.repository';
import { TiersModule } from '../tiers/tiers.module';
import { ConflictResolutionModule } from '../conflict/conflict.module';

@Module({
  imports: [TiersModule, forwardRef(() => ConflictResolutionModule)],
  controllers: [DevicesController],
  providers: [DevicesService, DevicesRepository],
  exports: [DevicesService, DevicesRepository],
})
export class DevicesModule {}
