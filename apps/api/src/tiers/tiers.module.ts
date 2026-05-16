import { Module } from '@nestjs/common';
import { TiersService } from './tiers.service';

@Module({
  providers: [TiersService],
  exports: [TiersService],
})
export class TiersModule {}
