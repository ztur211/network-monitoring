import { describe, it, expect } from 'vitest';
import { buildChartPath } from '../metric-chart';
describe('buildChartPath', () => {
  it('maps points to an SVG polyline path within the box, with min/max/last', () => {
    const r = buildChartPath([{ t: 0, v: 0 }, { t: 10, v: 10 }], 100, 50);
    expect(r.min).toBe(0); expect(r.max).toBe(10); expect(r.last).toBe(10);
    expect(r.path.startsWith('M')).toBe(true);
    // first point at left/bottom, last at right/top (y inverted)
    expect(r.path).toContain('M 0 50'); expect(r.path).toContain('L 100 0');
  });
  it('handles empty + single point without NaN', () => {
    expect(buildChartPath([], 100, 50)).toEqual({ path: '', min: 0, max: 0, last: null });
    const one = buildChartPath([{ t: 5, v: 7 }], 100, 50);
    expect(one.last).toBe(7); expect(one.path).not.toContain('NaN');
  });
});
