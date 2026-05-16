import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './guards/auth.guard';
import { TierGuard } from './guards/tier.guard';
import { RoleGuard } from './guards/role.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthGuard, TierGuard, RoleGuard],
  exports: [AuthGuard, TierGuard, RoleGuard],
})
export class AuthModule {}
