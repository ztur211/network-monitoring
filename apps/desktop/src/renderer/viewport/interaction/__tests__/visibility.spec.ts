import { describe, it, expect } from 'vitest';
import { isElementVisible } from '../visibility';

describe('isElementVisible', () => {
  const base = {
    hiddenCategories: new Set<string>(),
    hiddenElements: new Set<number>(),
    isolated: null as number | null,
  };
  it('visible by default', () => expect(isElementVisible(1, 'IfcWall', base)).toBe(true));
  it('hidden when its category is hidden', () =>
    expect(isElementVisible(1, 'IfcWall', { ...base, hiddenCategories: new Set(['IfcWall']) })).toBe(false));
  it('hidden when individually hidden', () =>
    expect(isElementVisible(1, 'IfcWall', { ...base, hiddenElements: new Set([1]) })).toBe(false));
  it('isolation hides all but the isolated element', () => {
    expect(isElementVisible(1, 'IfcWall', { ...base, isolated: 2 })).toBe(false);
    expect(isElementVisible(2, 'IfcWall', { ...base, isolated: 2 })).toBe(true);
  });
});
