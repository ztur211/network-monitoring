import { describe, it, expect } from 'vitest';
import { canConfigure } from '../can-configure';

describe('canConfigure', () => {
  it('OWNER and ADMIN may configure; MEMBER may not; null → false', () => {
    expect(canConfigure({ role: 'OWNER', assignedRootPropertyIds: [], unscoped: true })).toBe(true);
    expect(canConfigure({ role: 'ADMIN', assignedRootPropertyIds: ['p'], unscoped: false })).toBe(true);
    expect(canConfigure({ role: 'MEMBER', assignedRootPropertyIds: ['p'], unscoped: false })).toBe(false);
    expect(canConfigure(null)).toBe(false);
  });
});
