import { describe, it, expect } from 'vitest';
import { buildIfcLinkIndex, buildGuidByExpressId, deviceForElement } from '../element-link';

const dev = (id: string, ifcGlobalId: string | null) => ({ id, ifcGlobalId }) as any;

describe('buildIfcLinkIndex', () => {
  it('indexes guid → device, skipping devices with no link', () => {
    const index = buildIfcLinkIndex([dev('a', 'G1'), dev('b', null), dev('c', 'G2')]);
    expect(index.size).toBe(2);
    expect(index.get('G1')?.id).toBe('a');
    expect(index.get('G2')?.id).toBe('c');
    expect(index.has('')).toBe(false);
  });
});

describe('buildGuidByExpressId', () => {
  it('reverses the model guidIndex (guid → expressID becomes expressID → guid)', () => {
    const model = { guidIndex: new Map([['G1', 10], ['G2', 20]]) } as any;
    const rev = buildGuidByExpressId(model);
    expect(rev.get(10)).toBe('G1');
    expect(rev.get(20)).toBe('G2');
  });
});

describe('deviceForElement', () => {
  const linkIndex = buildIfcLinkIndex([dev('a', 'G1')]);
  const guidByExpressId = new Map<number, string>([
    [10, 'G1'],
    [20, 'G2'],
  ]);

  it('resolves a clicked linked element to its device', () => {
    expect(deviceForElement(linkIndex, guidByExpressId, 10)?.id).toBe('a');
  });
  it('returns undefined for an element whose guid no device claims', () => {
    expect(deviceForElement(linkIndex, guidByExpressId, 20)).toBeUndefined();
  });
  it('returns undefined for an element with no guid', () => {
    expect(deviceForElement(linkIndex, guidByExpressId, 99)).toBeUndefined();
  });
});
