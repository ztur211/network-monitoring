/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { WS_EVENTS } from '@nodescope/shared';
import { useModelRealtime } from '../use-model-realtime';
import { useViewportStore, initialViewportState } from '../../stores/viewport-store';
import { setClients } from '../../data/clients';

function fakeRealtime() {
  const handlers: Record<string, (p: any) => void> = {};
  return {
    on: (e: string, h: (p: any) => void) => {
      handlers[e] = h;
    },
    off: vi.fn(),
    emit: (e: string, p: any) => handlers[e]?.(p),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

beforeEach(() => useViewportStore.setState(initialViewportState()));
afterEach(() => {
  cleanup();
  setClients(null);
});

describe('useModelRealtime', () => {
  it('flags an update when the active building model is activated', () => {
    const rt = fakeRealtime();
    setClients({ realtime: rt, rest: {} } as any);
    useViewportStore.setState({ activeBuildingPropertyId: 'b1' });
    renderHook(() => useModelRealtime());
    rt.emit(WS_EVENTS.BUILDING_MODEL_ACTIVATED, { propertyId: 'b1' });
    expect(useViewportStore.getState().updateAvailable).toBe(true);
  });

  it('ignores events for a different building', () => {
    const rt = fakeRealtime();
    setClients({ realtime: rt, rest: {} } as any);
    useViewportStore.setState({ activeBuildingPropertyId: 'b1' });
    renderHook(() => useModelRealtime());
    rt.emit(WS_EVENTS.BUILDING_MODEL_ACTIVATED, { propertyId: 'OTHER' });
    expect(useViewportStore.getState().updateAvailable).toBe(false);
  });

  it('reverts to empty when the active building model is deleted', () => {
    const rt = fakeRealtime();
    setClients({ realtime: rt, rest: {} } as any);
    useViewportStore.setState({ activeBuildingPropertyId: 'b1', status: 'ready' });
    renderHook(() => useModelRealtime());
    rt.emit(WS_EVENTS.BUILDING_MODEL_DELETED, { propertyId: 'b1' });
    expect(useViewportStore.getState().status).toBe('empty');
  });
});
