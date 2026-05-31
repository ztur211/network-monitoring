import { forwardRef, Module } from '@nestjs/common';
import { ConflictResolutionService } from './conflict.service';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [forwardRef(() => RealtimeModule)],
  providers: [ConflictResolutionService],
  exports: [ConflictResolutionService],
})
export class ConflictResolutionModule {}
