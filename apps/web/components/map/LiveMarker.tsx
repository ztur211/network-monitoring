// LiveMarker is a vanilla DOM helper, not a React component — MapLibre's
// Marker class takes an HTMLElement, so the marker contents are imperative.
// React-side state (device row, latest metrics) is passed in by MapView.tsx
// and the marker is rebuilt when either changes.

export interface LiveMarkerInfo {
  name?: string | null;
  latencyMs?: number | null;
  downMbps?: number | null;
  upMbps?: number | null;
  onClick?: () => void;
}

export function createLiveMarkerElement(info: LiveMarkerInfo = {}): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    pointer-events: none;
  `;

  if (info.name) {
    el.appendChild(createLabel(info.name));
  }

  el.appendChild(createPulseCore(info.onClick));

  const stats = formatStats(info);
  if (stats) {
    el.appendChild(createStatsBadge(stats));
  }

  injectPulseKeyframes();
  return el;
}

function createLabel(name: string): HTMLDivElement {
  const label = document.createElement('div');
  label.textContent = name;
  label.style.cssText = `
    background: white;
    color: #0f172a;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 9999px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    margin-bottom: 4px;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `;
  return label;
}

function createPulseCore(onClick?: () => void): HTMLDivElement {
  const core = document.createElement('div');
  core.style.cssText = `
    width: 44px;
    height: 44px;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: ${onClick ? 'auto' : 'none'};
    cursor: ${onClick ? 'pointer' : 'default'};
  `;

  const ring = document.createElement('div');
  ring.style.cssText = `
    position: absolute;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(37, 99, 235, 0.3);
    animation: ns-pulse 2s ease-out infinite;
  `;

  const dot = document.createElement('div');
  dot.style.cssText = `
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #2563eb;
    border: 3px solid white;
    box-shadow: 0 2px 8px rgba(37, 99, 235, 0.6);
    position: relative;
    z-index: 1;
  `;

  core.appendChild(ring);
  core.appendChild(dot);

  if (onClick) {
    core.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
  }

  return core;
}

function createStatsBadge(text: string): HTMLDivElement {
  const badge = document.createElement('div');
  badge.textContent = text;
  badge.style.cssText = `
    background: rgba(15, 23, 42, 0.85);
    color: white;
    font-size: 10px;
    font-weight: 500;
    padding: 2px 6px;
    border-radius: 6px;
    margin-top: 4px;
    white-space: nowrap;
  `;
  return badge;
}

function formatStats(info: LiveMarkerInfo): string | null {
  const parts: string[] = [];
  if (typeof info.latencyMs === 'number' && Number.isFinite(info.latencyMs)) {
    parts.push(`${Math.round(info.latencyMs)} ms`);
  }
  if (typeof info.downMbps === 'number' && Number.isFinite(info.downMbps)) {
    parts.push(`↓${info.downMbps.toFixed(0)}`);
  }
  if (typeof info.upMbps === 'number' && Number.isFinite(info.upMbps)) {
    parts.push(`↑${info.upMbps.toFixed(0)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function injectPulseKeyframes(): void {
  if (document.getElementById('ns-live-marker-styles')) return;
  const style = document.createElement('style');
  style.id = 'ns-live-marker-styles';
  style.textContent = `
    @keyframes ns-pulse {
      0% { transform: scale(0.5); opacity: 1; }
      100% { transform: scale(2.5); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}
