import { Module } from '@nestjs/common';
import { BandwidthController } from './bandwidth.controller';

@Module({
  controllers: [BandwidthController],
})
export class BandwidthModule {}
