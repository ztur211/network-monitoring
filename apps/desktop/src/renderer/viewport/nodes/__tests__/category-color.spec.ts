import { describe, it, expect } from 'vitest';
import { categoryColor } from '../category-color';

const PALETTE = new Set([0x4f86f7, 0x35c46a, 0xf5a623, 0xb36ae2, 0xe5484d, 0x21c0c0, 0xe28f3a, 0x8a8f98]);

describe('categoryColor', () => {
  it('returns a palette colour, deterministically per category', () => {
    expect(PALETTE.has(categoryColor('SWITCH'))).toBe(true);
    expect(categoryColor('SWITCH')).toBe(categoryColor('SWITCH'));
    expect(PALETTE.has(categoryColor('ROUTER'))).toBe(true);
  });
});
