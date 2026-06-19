import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bootstrap } from '../use-bootstrap';
import { useSitesStore } from '../../stores/sites-store';
import { useAuthStore } from '../../stores/auth-store';

describe('bootstrap', () => {
  beforeEach(() => {
    useSitesStore.setState({ properties: [], selectedBuildingId: null });
    useAuthStore.setState({ authed: false, org: null });
  });

  it('loads org + properties into the stores and connects realtime', async () => {
    const rest = {
      getOrganization: vi.fn().mockResolvedValue({ id: 'o', name: 'Acme' }),
      listProperties: vi.fn().mockResolvedValue([{ id: 'b' }]),
    };
    const realtime = { connect: vi.fn().mockResolvedValue(undefined), on: vi.fn() };

    await bootstrap({ rest, realtime } as any);

    expect(useAuthStore.getState().org).toEqual({ id: 'o', name: 'Acme' });
    expect(useSitesStore.getState().properties).toEqual([{ id: 'b' }]);
    expect(realtime.connect).toHaveBeenCalled();
    expect(realtime.on).toHaveBeenCalled();
  });
});
