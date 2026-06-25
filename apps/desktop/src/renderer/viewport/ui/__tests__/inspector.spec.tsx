/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Inspector } from '../Inspector';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';

beforeEach(() => useViewportStore.setState(initialViewportState()));
afterEach(() => cleanup());

function modelWithProps() {
  return {
    elementIndex: new Map([[5, {}]]),
    guidIndex: new Map<string, number>(),
    getProperties: vi.fn().mockResolvedValue({
      expressID: 5,
      ifcType: 'IfcWall',
      name: 'Wall-1',
      tag: 'W1',
      propertySets: [{ name: 'Pset_WallCommon', props: [{ name: 'IsExternal', value: 'true' }] }],
    }),
  } as any;
}

describe('Inspector', () => {
  it('renders nothing without a selection', () => {
    useViewportStore.setState({ model: modelWithProps(), selection: null });
    const { container } = render(<Inspector />);
    expect(container.firstChild).toBeNull();
  });
  it('shows the selected element properties and acts on it', async () => {
    useViewportStore.setState({ model: modelWithProps(), selection: { kind: 'element', expressID: 5 } });
    render(<Inspector />);
    await waitFor(() => expect(screen.getByText('Wall-1')).toBeTruthy());
    expect(screen.getByText('IsExternal')).toBeTruthy();
    fireEvent.click(screen.getByText('Isolate'));
    expect(useViewportStore.getState().isolated).toBe(5);
    fireEvent.click(screen.getByText('Hide'));
    expect(useViewportStore.getState().hiddenElements.has(5)).toBe(true);
    fireEvent.click(screen.getByText('Zoom to'));
    expect(useViewportStore.getState().focusNonce).toBe(1);
  });
});
