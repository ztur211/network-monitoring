import { forwardRef, Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ConflictResolutionModule } from '../conflict/conflict.module';
import { DevicesModule } from '../devices/devices.module';
import { MapModule } from '../map/map.module';
import { NetworksModule } from '../networks/networks.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { UsersModule } from '../users/users.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [
    AiModule,
    ConflictResolutionModule,
    DevicesModule,
    MapModule,
    NetworksModule,
    UsersModule,
    forwardRef(() => RealtimeModule),
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
