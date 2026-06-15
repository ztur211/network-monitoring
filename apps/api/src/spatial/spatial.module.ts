import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BuildingModelsModule } from '../building-models/building-models.module';
import { SpatialController } from './spatial.controller';
import { SpatialService } from './spatial.service';
import { SpatialRepository } from './spatial.repository';

@Module({
  imports: [PrismaModule, BuildingModelsModule], // BuildingModelsModule exports BuildingModelsRepository
  controllers: [SpatialController],
  providers: [SpatialService, SpatialRepository],
  exports: [SpatialRepository], // exported for the DevicesService coordinate-clear-on-move hook
})
export class SpatialModule {}
