import { Module } from '@nestjs/common';
import { TimescaleService } from './timescale.service';

@Module({
  providers: [TimescaleService],
  exports: [TimescaleService],
})
export class TimescaleModule {}
