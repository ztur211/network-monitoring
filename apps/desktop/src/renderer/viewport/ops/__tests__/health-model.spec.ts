// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { DeviceDto } from '@nodescope/shared';
import type { NodeStatus } from '../../nodes/node-status';
import { healthCounts, sortedNodes, byFloor, emphasisFor } from '../health-model';

const dev = (id: string, name: string, floor: number | null, floorLabel: string | null = null): DeviceDto =>
  ({ id, name, category: 'SWITCH', floor, floorLabel } as DeviceDto);
const status = (pairs: [string, NodeStatus][]) => new Map<string, NodeStatus>(pairs);

describe('health-model', () => {
  const devices = [dev('a', 'A', 3), dev('b', 'B', 1), dev('c', 'C', 1), dev('d', 'D', null)];
  const ns = status([['a', 'down'], ['b', 'warning'], ['c', 'up']]); // d → unknown (absent)

  it('healthCounts tallies by status (absent → unknown)', () => {
    expect(healthCounts(devices, ns)).toEqual({ down: 1, warning: 1, unknown: 1, up: 1, total: 4 });
  });

  it('sortedNodes orders down → warning → unknown → up, tiebreak floor then name', () => {
    const ids = sortedNodes(devices, ns).map((n) => n.device.id);
    expect(ids).toEqual(['a', 'b', 'd', 'c']); // down(a), warning(b), unknown(d), up(c)
  });

  it('sortedNodes problemsOnly keeps only down + warning', () => {
    expect(sortedNodes(devices, ns, { problemsOnly: true }).map((n) => n.device.id)).toEqual(['a', 'b']);
  });

  it('byFloor groups by floor (null → Unassigned), worst floor first', () => {
    const floors = byFloor(devices, ns);
    // floor 3 has 'a' down (worst) → first; floor 1 has warning; Unassigned (d, unknown) last
    expect(floors.map((f) => f.label)).toEqual(['Floor 3', 'Floor 1', 'Unassigned']);
    expect(floors[0].counts.down).toBe(1);
    expect(floors.find((f) => f.floor === null)!.nodes.map((n) => n.device.id)).toEqual(['d']);
  });

  it('emphasisFor: down/warning get bigger halo + pulse; up/unknown baseline', () => {
    expect(emphasisFor('down')).toEqual({ halo: 2.2, pulse: true });
    expect(emphasisFor('warning')).toEqual({ halo: 1.8, pulse: true });
    expect(emphasisFor('up')).toEqual({ halo: 1.5, pulse: false });
    expect(emphasisFor('unknown')).toEqual({ halo: 1.5, pulse: false });
  });

  it('byFloor uses a non-null floorLabel and counts per floor', () => {
    const ds = [dev('x', 'X', 2, 'Mezzanine'), dev('y', 'Y', 2)];
    const f = byFloor(ds, status([['x', 'warning'], ['y', 'up']]));
    expect(f).toHaveLength(1);
    expect(f[0].label).toBe('Mezzanine');
    expect(f[0].counts).toMatchObject({ warning: 1, up: 1, total: 2 });
  });
});
