import { forwardRef, Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DevicesRepository } from './devices.repository';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ConflictResolutionModule } from '../conflict/conflict.module';
import { PropertiesModule } from '../properties/properties.module';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';

@Module({
  imports: [OrganizationsModule, forwardRef(() => ConflictResolutionModule), PropertiesModule],
  controllers: [DevicesController],
  providers: [DevicesService, DevicesRepository, IdempotencyInterceptor],
  exports: [DevicesService, DevicesRepository],
})
export class DevicesModule {}
