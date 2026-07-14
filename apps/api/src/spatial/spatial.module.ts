import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PropertyTreeModule } from '../property-tree/property-tree.module';
import { BuildingModelsModule } from '../building-models/building-models.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ConflictResolutionModule } from '../conflict/conflict.module';
import { SpatialController } from './spatial.controller';
import { SpatialService } from './spatial.service';
import { SpatialRepository } from './spatial.repository';

@Module({
  // BuildingModelsModule exports BuildingModelsRepository; PermissionsModule (F3 scope) +
  // ConflictResolutionModule (realtime emit) added for Spec 4 placement authorization + live sync.
  // PropertyTreeModule supplies the shared, cycle-guarded upward walk of the property hierarchy.
  imports: [PrismaModule, PropertyTreeModule, BuildingModelsModule, PermissionsModule, ConflictResolutionModule],
  controllers: [SpatialController],
  providers: [SpatialService, SpatialRepository],
  exports: [SpatialRepository], // exported for the DevicesService coordinate-clear-on-move hook
})
export class SpatialModule {}
