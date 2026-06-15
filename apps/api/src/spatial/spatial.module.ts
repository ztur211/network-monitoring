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
  exports: [SpatialRepository], // Task 4's DevicesService hook will inject this
})
export class SpatialModule {}
