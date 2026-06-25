/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ViewportHost } from '../../../shell/ViewportHost';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';

// presentation-only: stub the side-effectful hooks so they don't drive status
vi.mock('../../use-viewport-loader', () => ({ useViewportLoader: () => {} }));
vi.mock('../../use-model-realtime', () => ({ useModelRealtime: () => {} }));
// the ready slot now mounts a real r3f <Canvas>, which jsdom can't host
vi.mock('../../scene/ViewportCanvas', () => ({ ViewportCanvas: () => null }));

beforeEach(() => useViewportStore.setState(initialViewportState()));
afterEach(() => cleanup());

describe('ViewportHost states', () => {
  it('idle prompts to select a building', () => {
    render(<ViewportHost />);
    expect(screen.getByText(/select a building/i)).toBeTruthy();
  });
  it('empty explains there is no model', () => {
    useViewportStore.setState({ activeBuildingPropertyId: 'b', status: 'empty' });
    render(<ViewportHost />);
    expect(screen.getByText(/no 3d model/i)).toBeTruthy();
  });
  it('error shows the message and Retry triggers reload', () => {
    useViewportStore.setState({ activeBuildingPropertyId: 'b', status: 'error', error: 'boom' });
    render(<ViewportHost />);
    expect(screen.getByText(/boom/)).toBeTruthy();
    fireEvent.click(screen.getByText('Retry'));
    expect(useViewportStore.getState().reloadNonce).toBe(1);
  });
  it('updateAvailable shows the reload banner over the ready slot', () => {
    useViewportStore.setState({
      activeBuildingPropertyId: 'b',
      status: 'ready',
      updateAvailable: true,
      // Toolbar (in the ready slot) now reads model.render.categories; ViewportCanvas is mocked to
      // null so nothing else touches render here — a categories-only stub is sufficient.
      model: { elementIndex: new Map(), guidIndex: new Map(), categories: new Map(), render: { categories: new Map() } } as any,
    });
    render(<ViewportHost />);
    fireEvent.click(screen.getByText('Reload'));
    expect(useViewportStore.getState().updateAvailable).toBe(false);
  });
});
