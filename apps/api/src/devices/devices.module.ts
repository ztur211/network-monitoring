import { forwardRef, Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DevicesRepository } from './devices.repository';
import { NameSuggestionService } from './name-suggestion.service';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ConflictResolutionModule } from '../conflict/conflict.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { PropertiesModule } from '../properties/properties.module';
import { SpatialModule } from '../spatial/spatial.module';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';

@Module({
  imports: [OrganizationsModule, forwardRef(() => ConflictResolutionModule), PropertiesModule, PermissionsModule, SpatialModule],
  controllers: [DevicesController],
  providers: [DevicesService, DevicesRepository, IdempotencyInterceptor, NameSuggestionService],
  exports: [DevicesService, DevicesRepository],
})
export class DevicesModule {}
