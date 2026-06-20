// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Regression test for the crash-on-launch bug: useViewportLoader used a default
// parameter `loader = createIfcModelLoader()`, which ran on EVERY render and put a
// fresh loader identity into the effect's dependency array → setState → re-render →
// new loader → infinite loop (React #185), blanking the 3D Shell. The loadBuilding
// unit tests never rendered the hook, so they missed it. The fix builds the default
// loader once. Here we assert it is constructed at most once across rerenders.
const { createIfcModelLoader } = vi.hoisted(() => ({
  createIfcModelLoader: vi.fn(() => ({ loadModel: vi.fn() })),
}));
vi.mock('../ifc/ifc-model-loader', () => ({ createIfcModelLoader }));

import { useViewportLoader } from '../use-viewport-loader';

describe('useViewportLoader (hook)', () => {
  beforeEach(() => createIfcModelLoader.mockClear());

  it('constructs the default loader once across rerenders (no infinite loop)', () => {
    const { rerender } = renderHook(() => useViewportLoader());
    rerender();
    rerender();
    expect(createIfcModelLoader).toHaveBeenCalledTimes(1);
  });
});
