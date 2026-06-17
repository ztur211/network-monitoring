/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DeviceDetails } from '../DeviceDetails';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';

vi.mock('../../../data/clients', () => ({
  getClients: () => ({ rest: { setDevicePosition: vi.fn().mockResolvedValue({}) } }),
}));

const dev = (over = {}) =>
  ({
    id: 'd',
    name: 'Switch-1',
    category: 'SWITCH',
    propertyId: 'b',
    networkId: 'n',
    x: null,
    y: null,
    z: null,
    floor: 1,
    ipAddress: '10.0.0.5',
    macAddress: null,
    ...over,
  }) as any;
const admin = { role: 'ADMIN', assignedRootPropertyIds: ['b'], unscoped: false } as any;
const member = { role: 'MEMBER', assignedRootPropertyIds: ['b'], unscoped: false } as any;

beforeEach(() =>
  useViewportStore.setState({
    ...initialViewportState(),
    devices: [dev()],
    selection: { kind: 'device', deviceId: 'd' },
  }),
);
afterEach(() => cleanup());

describe('DeviceDetails', () => {
  it('shows fields and (for ADMIN) a Place action for an unplaced device', () => {
    useViewportStore.setState({ access: admin });
    render(<DeviceDetails />);
    expect(screen.getByText('Switch-1')).toBeTruthy();
    expect(screen.getByText('Unplaced')).toBeTruthy();
    fireEvent.click(screen.getByText('Place'));
    expect(useViewportStore.getState().placingDeviceId).toBe('d');
  });

  it('shows Move + Clear + Zoom for a placed device (ADMIN)', () => {
    useViewportStore.setState({ access: admin, devices: [dev({ x: 1, y: 2, z: 3 })] });
    render(<DeviceDetails />);
    expect(screen.getByText('Move')).toBeTruthy();
    expect(screen.getByText('Clear')).toBeTruthy();
    fireEvent.click(screen.getByText('Zoom to'));
    expect(useViewportStore.getState().focusNonce).toBe(1);
  });

  it('hides configure actions for a MEMBER', () => {
    useViewportStore.setState({ access: member });
    render(<DeviceDetails />);
    expect(screen.queryByText('Place')).toBeNull();
  });
});
