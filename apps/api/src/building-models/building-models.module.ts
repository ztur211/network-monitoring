import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { PropertiesModule } from '../properties/properties.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { BuildingModelsController } from './building-models.controller';
import { BuildingModelsService } from './building-models.service';
import { BuildingModelsRepository } from './building-models.repository';

// AuditService comes from the @Global() AuditModule; RealtimeModule provides REALTIME_SERVICE.
@Module({
  imports: [PrismaModule, StorageModule, PropertiesModule, PermissionsModule, RealtimeModule],
  controllers: [BuildingModelsController],
  providers: [BuildingModelsService, BuildingModelsRepository],
  exports: [BuildingModelsService, BuildingModelsRepository],
})
export class BuildingModelsModule {}
