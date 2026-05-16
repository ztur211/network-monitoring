export function createLiveMarkerElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `
    width: 44px;
    height: 44px;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  // Pulse ring
  const ring = document.createElement('div');
  ring.style.cssText = `
    position: absolute;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(37, 99, 235, 0.3);
    animation: ns-pulse 2s ease-out infinite;
  `;

  // Core dot
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

  el.appendChild(ring);
  el.appendChild(dot);

  injectPulseKeyframes();
  return el;
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
