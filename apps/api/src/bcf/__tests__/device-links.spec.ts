import { deriveDeviceLinks } from '../device-links';

describe('deriveDeviceLinks', () => {
  const guidMap = new Map<string, string>([
    ['1aBcGUID000000000000000', 'device-1'],
    ['2xYzGUID000000000000000', 'device-2'],
  ]);

  it('returns matched device ids for known ifcGuids', () => {
    const components = [
      { ifcGuid: '1aBcGUID000000000000000' },
      { ifcGuid: '2xYzGUID000000000000000' },
    ];
    const result = deriveDeviceLinks(components, guidMap);
    expect(result).toHaveLength(2);
    expect(result).toContain('device-1');
    expect(result).toContain('device-2');
  });

  it('deduplicates when multiple components map to the same device', () => {
    const components = [
      { ifcGuid: '1aBcGUID000000000000000' },
      { ifcGuid: '1aBcGUID000000000000000' }, // same guid twice
    ];
    const result = deriveDeviceLinks(components, guidMap);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('device-1');
  });

  it('ignores components whose ifcGuid is not in the map', () => {
    const components = [
      { ifcGuid: 'UNKNOWN_GUID_000000000000' },
    ];
    const result = deriveDeviceLinks(components, guidMap);
    expect(result).toHaveLength(0);
  });

  it('returns [] for empty components', () => {
    const result = deriveDeviceLinks([], guidMap);
    expect(result).toHaveLength(0);
  });

  it('handles an empty map (no devices in building)', () => {
    const components = [{ ifcGuid: '1aBcGUID000000000000000' }];
    const result = deriveDeviceLinks(components, new Map());
    expect(result).toHaveLength(0);
  });
});
