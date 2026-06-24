/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { OpsHud } from '../OpsHud';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';
import type { DeviceDto } from '@nodescope/shared';

const dev = (id: string, name: string, floor: number | null): DeviceDto =>
  ({ id, name, category: 'SWITCH', floor, floorLabel: null, x: 0, y: 0, z: 0 } as DeviceDto);

beforeEach(() => {
  useViewportStore.setState(initialViewportState());
  useViewportStore.setState({
    devices: [dev('a', 'Alpha', 3), dev('b', 'Bravo', 1), dev('c', 'Charlie', 1)],
    nodeStatus: new Map([['a', 'down'], ['b', 'warning'], ['c', 'up']]),
  });
});
afterEach(() => cleanup());

describe('OpsHud', () => {
  it('shows down/warning counts in the header', () => {
    render(<OpsHud />);
    expect(screen.getByLabelText('down-count').textContent).toContain('1');
    expect(screen.getByLabelText('warning-count').textContent).toContain('1');
  });

  it('expands to a severity-sorted list (down first) and flies to a clicked device', () => {
    render(<OpsHud />);
    fireEvent.click(screen.getByLabelText('toggle-ops-hud'));
    const rows = screen.getAllByRole('button', { name: /ops-row/ });
    expect(rows[0].textContent).toContain('Alpha'); // down first
    const before = useViewportStore.getState().focusNonce;
    fireEvent.click(rows[0]);
    const s = useViewportStore.getState();
    expect(s.selection).toEqual({ kind: 'device', deviceId: 'a' });
    expect(s.focusNonce).toBeGreaterThan(before); // requestFocus bumped the focus nonce
  });

  it('problems-only hides healthy devices', () => {
    render(<OpsHud />);
    fireEvent.click(screen.getByLabelText('toggle-ops-hud'));
    fireEvent.click(screen.getByLabelText('problems-only'));
    expect(screen.queryByText('Charlie')).toBeNull(); // up → hidden
    expect(screen.getByText('Alpha')).toBeTruthy();
  });

  it('by-floor groups devices worst-floor-first with per-floor counts', () => {
    render(<OpsHud />);
    fireEvent.click(screen.getByLabelText('toggle-ops-hud'));
    fireEvent.click(screen.getByLabelText('by-floor'));
    const t = document.body.textContent ?? '';
    expect(t).toContain('Floor 3'); // Alpha (down)
    expect(t).toContain('Floor 1'); // Bravo (warning) + Charlie (up)
    expect(t.indexOf('Floor 3')).toBeLessThan(t.indexOf('Floor 1')); // worst-severity floor first
  });
});
