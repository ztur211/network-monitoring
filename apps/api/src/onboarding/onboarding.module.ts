import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ConflictResolutionModule } from '../conflict/conflict.module';
import { DevicesModule } from '../devices/devices.module';
import { MapModule } from '../map/map.module';
import { NetworksModule } from '../networks/networks.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [
    AiModule,
    ConflictResolutionModule,
    DevicesModule,
    MapModule,
    NetworksModule,
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
