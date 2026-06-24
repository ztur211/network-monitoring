/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DeviceTelemetry } from '../DeviceTelemetry';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';
import type { DeviceDto } from '@nodescope/shared';

// ── mock the telemetry hooks module ─────────────────────────────────────────
vi.mock('../../telemetry/use-device-telemetry', () => ({
  useDeviceMetricNames: vi.fn(),
  useDeviceMetricSeries: vi.fn(),
  useDeviceStatusEvents: vi.fn(),
}));

import {
  useDeviceMetricNames,
  useDeviceMetricSeries,
  useDeviceStatusEvents,
} from '../../telemetry/use-device-telemetry';

const mockNames = useDeviceMetricNames as ReturnType<typeof vi.fn>;
const mockSeries = useDeviceMetricSeries as ReturnType<typeof vi.fn>;
const mockEvents = useDeviceStatusEvents as ReturnType<typeof vi.fn>;

const dev = (id: string): DeviceDto =>
  ({ id, name: 'Switch-A', category: 'SWITCH', floor: 1, floorLabel: '1F', x: 0, y: 0, z: 0, networkId: 'net1', ipAddress: null } as DeviceDto);

beforeEach(() => {
  useViewportStore.setState(initialViewportState());
  useViewportStore.setState({
    devices: [dev('d1')],
    selection: { kind: 'device', deviceId: 'd1' },
  });
  // default: populated data
  mockNames.mockReturnValue({ names: ['cpu_pct', 'mem_pct'], loading: false });
  mockSeries.mockReturnValue({ points: [{ t: 1000, v: 42 }, { t: 2000, v: 55 }] });
  mockEvents.mockReturnValue({
    events: [{ time: '2026-01-01T00:00:00Z', state: 'UP', source: 'snmp' }],
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DeviceTelemetry', () => {
  it('renders nothing when no device is selected', () => {
    useViewportStore.setState({ selection: null });
    const { container } = render(<DeviceTelemetry />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when selection is an element, not a device', () => {
    useViewportStore.setState({ selection: { kind: 'element', expressID: 99 } });
    const { container } = render(<DeviceTelemetry />);
    expect(container.firstChild).toBeNull();
  });

  it('shows a metric <select> populated with names', () => {
    render(<DeviceTelemetry />);
    const sel = screen.getByRole('combobox', { name: /metric/i });
    const options = Array.from((sel as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toContain('cpu_pct');
    expect(options).toContain('mem_pct');
  });

  it('renders an svg path when points are available', () => {
    render(<DeviceTelemetry />);
    const svg = document.querySelector('svg');
    expect(svg).not.toBeNull();
    const path = svg!.querySelector('path');
    // buildChartPath produces a non-empty d attribute for 2 points
    expect(path).not.toBeNull();
    expect(path!.getAttribute('d')).not.toBe('');
  });

  it('shows event state in the recent events list', () => {
    render(<DeviceTelemetry />);
    expect(screen.getByText(/UP/)).toBeTruthy();
  });

  it('shows "No metrics yet" when names is empty', () => {
    mockNames.mockReturnValue({ names: [], loading: false });
    render(<DeviceTelemetry />);
    expect(screen.getByText('No metrics yet')).toBeTruthy();
  });

  it('shows "No recent events" when events is empty', () => {
    mockEvents.mockReturnValue({ events: [] });
    render(<DeviceTelemetry />);
    expect(screen.getByText('No recent events')).toBeTruthy();
  });

  it('shows "No data" placeholder in the chart when points is empty', () => {
    mockSeries.mockReturnValue({ points: [] });
    render(<DeviceTelemetry />);
    expect(screen.getByText('No data')).toBeTruthy();
  });
});
