import { TiersService, FREE_TIER_DEVICE_LIMIT } from '../tiers.service';

describe('TiersService', () => {
  let service: TiersService;

  beforeEach(() => {
    service = new TiersService();
  });

  describe('getDeviceLimit', () => {
    it('returns FREE_TIER_DEVICE_LIMIT for PERSONAL_FREE', () => {
      expect(service.getDeviceLimit('PERSONAL_FREE')).toBe(FREE_TIER_DEVICE_LIMIT);
    });

    it('returns Infinity for PERSONAL_PAID', () => {
      expect(service.getDeviceLimit('PERSONAL_PAID')).toBe(Infinity);
    });

    it('returns Infinity for ENTERPRISE', () => {
      expect(service.getDeviceLimit('ENTERPRISE')).toBe(Infinity);
    });

    it('returns Infinity for unknown tier', () => {
      expect(service.getDeviceLimit('UNKNOWN')).toBe(Infinity);
    });
  });
});
