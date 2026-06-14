import { roleCodeOf } from '../role-code';

describe('roleCodeOf', () => {
  it('maps known categories to short codes', () => {
    expect(roleCodeOf('ROUTER')).toBe('rtr');
    expect(roleCodeOf('SWITCH')).toBe('sw');
  });
  it('falls back to a lowercased category for unmapped values', () => {
    expect(roleCodeOf('SOMETHING_NEW' as any)).toBe('something_new');
  });
});
