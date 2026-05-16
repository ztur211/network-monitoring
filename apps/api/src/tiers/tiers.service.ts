import { Injectable } from '@nestjs/common';

export const FREE_TIER_DEVICE_LIMIT = parseInt(process.env.FREE_TIER_DEVICE_LIMIT ?? '50', 10);

@Injectable()
export class TiersService {
  getDeviceLimit(tier: string): number {
    return tier === 'PERSONAL_FREE' ? FREE_TIER_DEVICE_LIMIT : Infinity;
  }
}
