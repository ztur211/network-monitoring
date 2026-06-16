import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { DesktopAuthController } from './desktop-auth.controller';
import { DesktopAuthService } from './desktop-auth.service';

@Module({
  imports: [RedisModule],
  controllers: [DesktopAuthController],
  providers: [DesktopAuthService],
})
export class DesktopAuthModule {}
