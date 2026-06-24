export interface ChartResult { path: string; min: number; max: number; last: number | null; }
export function buildChartPath(points: { t: number; v: number }[], width: number, height: number): ChartResult {
  if (points.length === 0) return { path: '', min: 0, max: 0, last: null };
  const vs = points.map((p) => p.v);
  const min = Math.min(...vs), max = Math.max(...vs);
  const ts = points.map((p) => p.t);
  const tMin = Math.min(...ts), tMax = Math.max(...ts);
  const spanT = tMax - tMin || 1, spanV = max - min || 1;
  const x = (t: number) => ((t - tMin) / spanT) * width;
  const y = (v: number) => height - ((v - min) / spanV) * height; // invert: higher value = higher on screen
  const cmds = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.t)} ${y(p.v)}`);
  return { path: cmds.join(' '), min, max, last: points[points.length - 1].v };
}
