// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Regression test for the crash-on-launch bug: useViewportLoader used a default
// parameter `loader = createIfcModelLoader()`, which ran on EVERY render and put a
// fresh loader identity into the effect's dependency array → setState → re-render →
// new loader → infinite loop (React #185), blanking the 3D Shell. The loadBuilding
// unit tests never rendered the hook, so they missed it. The fix builds the default
// loader once. Here we assert it is constructed at most once across rerenders.
const { createIfcModelLoader, disposeDefaultLoader } = vi.hoisted(() => ({
  disposeDefaultLoader: vi.fn(),
  createIfcModelLoader: vi.fn(() => ({ loadModel: vi.fn(), dispose: disposeDefaultLoader })),
}));
vi.mock('../ifc/ifc-model-loader', () => ({ createIfcModelLoader }));

import { useViewportLoader } from '../use-viewport-loader';

describe('useViewportLoader (hook)', () => {
  beforeEach(() => {
    createIfcModelLoader.mockClear();
    disposeDefaultLoader.mockClear();
  });

  it('constructs the default loader once across rerenders (no infinite loop)', () => {
    const { rerender } = renderHook(() => useViewportLoader());
    rerender();
    rerender();
    expect(createIfcModelLoader).toHaveBeenCalledTimes(1);
  });

  it('disposes its internally-created loader on unmount', () => {
    const { unmount } = renderHook(() => useViewportLoader());

    unmount();
    unmount();

    expect(disposeDefaultLoader).toHaveBeenCalledTimes(1);
  });

  it('does not dispose an injected loader unless ownership is transferred', () => {
    const external = { loadModel: vi.fn(), dispose: vi.fn() };
    const { unmount } = renderHook(() => useViewportLoader(external));

    unmount();

    expect(external.dispose).not.toHaveBeenCalled();
  });
});
