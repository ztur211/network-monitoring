import { SetMetadata } from '@nestjs/common';

export const REQUIRED_TIER_KEY = 'requiredTier';
export const RequireTier = (tier: string) => SetMetadata(REQUIRED_TIER_KEY, tier);
