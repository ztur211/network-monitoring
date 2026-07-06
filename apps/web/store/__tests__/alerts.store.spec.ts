import { useAlertsStore } from '../alerts.store';

const item = (id: string) =>
  ({
    id,
    kind: 'FIRING',
    severity: 'CRITICAL',
    at: '2026-01-01T00:00:00Z',
    ruleId: 'r',
    deviceId: 'd',
    detail: {},
  }) as never;

describe('alerts.store', () => {
  beforeEach(() => useAlertsStore.getState().reset());

  it('setInitial replaces the list', () => {
    useAlertsStore.getState().setInitial([item('a'), item('b')]);
    expect(useAlertsStore.getState().events.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('prepend adds newest-first and caps at 200', () => {
    useAlertsStore.getState().setInitial([item('old')]);
    useAlertsStore.getState().prepend(item('new'));
    expect(useAlertsStore.getState().events[0].id).toBe('new');
    for (let i = 0; i < 250; i++) useAlertsStore.getState().prepend(item(`x${i}`));
    expect(useAlertsStore.getState().events.length).toBe(200);
  });
});
