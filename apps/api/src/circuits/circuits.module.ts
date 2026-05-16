import { Module } from '@nestjs/common';
import { CircuitsController } from './circuits.controller';
import { CircuitsService } from './circuits.service';
import { CircuitsRepository } from './circuits.repository';
import { ConflictResolutionModule } from '../conflict/conflict.module';
import { DevicesModule } from '../devices/devices.module';

@Module({
  imports: [ConflictResolutionModule, DevicesModule],
  controllers: [CircuitsController],
  providers: [CircuitsService, CircuitsRepository],
  exports: [CircuitsRepository],
})
export class CircuitsModule {}
