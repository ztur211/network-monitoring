import { buildChartPath } from './metric-chart';
import type { MetricPoint } from './use-device-telemetry';

interface MetricChartProps {
  points: MetricPoint[];
  width?: number;
  height?: number;
}

export function MetricChart({ points, width = 280, height = 80 }: MetricChartProps) {
  if (points.length === 0) {
    return (
      <div
        style={{
          width,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#8a8f98',
          fontSize: 12,
          background: '#1a1d22',
          borderRadius: 4,
        }}
      >
        No data
      </div>
    );
  }

  const { path, min, max, last } = buildChartPath(points, width, height);

  return (
    <div style={{ position: 'relative', width, height }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block', background: '#1a1d22', borderRadius: 4 }}
      >
        <path d={path} fill="none" stroke="#35c46a" strokeWidth={1.5} />
      </svg>
      <div
        style={{
          position: 'absolute',
          top: 2,
          right: 4,
          fontSize: 10,
          color: '#8a8f98',
          lineHeight: 1.4,
        }}
      >
        <span>max {max.toFixed(1)}</span>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 2,
          right: 4,
          fontSize: 10,
          color: '#8a8f98',
          lineHeight: 1.4,
        }}
      >
        <span>min {min.toFixed(1)}</span>
      </div>
      {last !== null && (
        <div
          style={{
            position: 'absolute',
            bottom: 2,
            left: 4,
            fontSize: 10,
            color: '#fff',
          }}
        >
          {last.toFixed(1)}
        </div>
      )}
    </div>
  );
}
