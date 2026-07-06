import { useAccessStore, isOrgAdmin } from '../access.store';

describe('access.store', () => {
  beforeEach(() => useAccessStore.getState().reset());

  it('setAccess stores role + loaded', () => {
    useAccessStore.getState().setAccess({ role: 'OWNER', assignedRootPropertyIds: [], unscoped: true });
    expect(useAccessStore.getState().role).toBe('OWNER');
    expect(useAccessStore.getState().loaded).toBe(true);
  });

  it('reset clears', () => {
    useAccessStore.getState().setAccess({ role: 'OWNER', assignedRootPropertyIds: [], unscoped: true });
    useAccessStore.getState().reset();
    expect(useAccessStore.getState().role).toBeNull();
  });

  it('isOrgAdmin truth table', () => {
    expect(isOrgAdmin('OWNER')).toBe(true);
    expect(isOrgAdmin('ADMIN')).toBe(true);
    expect(isOrgAdmin('MEMBER')).toBe(false);
    expect(isOrgAdmin(null)).toBe(false);
  });
});
