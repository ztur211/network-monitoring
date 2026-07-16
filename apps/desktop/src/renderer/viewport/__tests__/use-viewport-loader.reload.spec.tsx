/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import { useViewportStore, initialViewportState } from '../../stores/viewport-store';

// The loader pulls its REST client from the data layer; give it a spyable one.
const getBuildingModel = vi.fn();
const getActiveModelFile = vi.fn();
vi.mock('../../data/clients', () => ({
  getClients: () => ({ rest: { getBuildingModel, getActiveModelFile } }),
}));

import { useViewportLoader } from '../use-viewport-loader';

const fakeModel = () => ({ dispose: vi.fn() });
const fakeLoader = () => ({ loadModel: vi.fn().mockResolvedValue(fakeModel()), dispose: vi.fn() });

beforeEach(() => {
  useViewportStore.setState(initialViewportState());
  getBuildingModel.mockReset().mockResolvedValue({ model: { id: 'bm' } });
  getActiveModelFile.mockReset().mockResolvedValue(new ArrayBuffer(8));
});
afterEach(() => cleanup());

describe('useViewportLoader — reload semantics', () => {
  it('a reload re-fetches the active building instead of serving cached geometry', async () => {
    const loader = fakeLoader();
    renderHook(() => useViewportLoader(loader as any));

    await act(async () => {
      useViewportStore.setState({ activeBuildingPropertyId: 'b1' });
    });
    await waitFor(() => expect(useViewportStore.getState().status).toBe('ready'));
    expect(getBuildingModel).toHaveBeenCalledTimes(1);

    // Reload (e.g. after an in-app import re-activates the model): must hit the network again.
    await act(async () => {
      useViewportStore.getState().reload();
    });
    await waitFor(() => expect(getBuildingModel).toHaveBeenCalledTimes(2));
    expect(loader.loadModel).toHaveBeenCalledTimes(2);
  });

  it('disposes shown and cached models plus an owned injected loader on unmount', async () => {
    const first = fakeModel();
    const second = fakeModel();
    const loader = {
      loadModel: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second),
      dispose: vi.fn(),
    };
    const { unmount } = renderHook(() =>
      useViewportLoader(loader as any, { disposeLoaderOnUnmount: true }),
    );

    await act(async () => {
      useViewportStore.setState({ activeBuildingPropertyId: 'b1' });
    });
    await waitFor(() => expect(useViewportStore.getState().model).toBe(first));

    await act(async () => {
      useViewportStore.setState({ activeBuildingPropertyId: 'b2' });
    });
    await waitFor(() => expect(useViewportStore.getState().model).toBe(second));

    unmount();

    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
    expect(loader.dispose).toHaveBeenCalledTimes(1);
    expect(useViewportStore.getState().model).toBeNull();
  });
});
