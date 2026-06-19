/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NodePanel } from '../NodePanel';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';

const dev = (id: string, over = {}) =>
  ({
    id,
    name: id,
    category: 'SWITCH',
    propertyId: 'b',
    networkId: 'n',
    x: null,
    y: null,
    z: null,
    floor: 1,
    ipAddress: null,
    macAddress: null,
    ...over,
  }) as any;

// merge reset so the store action fns survive
beforeEach(() =>
  useViewportStore.setState({
    ...initialViewportState(),
    devices: [dev('Switch-1', { x: 1, y: 1, z: 1 }), dev('Router-9', { category: 'ROUTER' })],
  }),
);
afterEach(() => cleanup());

describe('NodePanel', () => {
  it('lists devices and selects one on click', () => {
    render(<NodePanel />);
    expect(screen.getByText('Switch-1')).toBeTruthy();
    fireEvent.click(screen.getByText('Router-9'));
    expect(useViewportStore.getState().selection).toEqual({ kind: 'device', deviceId: 'Router-9' });
  });

  it('text filter narrows the list', () => {
    render(<NodePanel />);
    fireEvent.change(screen.getByLabelText('Filter devices'), { target: { value: 'router' } });
    expect(screen.queryByText('Switch-1')).toBeNull();
    expect(screen.getByText('Router-9')).toBeTruthy();
  });

  it('placement filter shows only unplaced', () => {
    render(<NodePanel />);
    fireEvent.change(screen.getByLabelText('Placement'), { target: { value: 'unplaced' } });
    expect(screen.queryByText('Switch-1')).toBeNull(); // placed → hidden
    expect(screen.getByText('Router-9')).toBeTruthy();
  });
});
