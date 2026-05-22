import { DeviceDto, DeviceCategory, DEVICE_CATEGORY_CONFIG } from '@nodescope/shared';

// Non-status palette — PRD §10.1 honesty item #1 forbids green/amber/red on
// documented-only markers because those colors imply health status NodeScope
// cannot monitor for devices without a live data source.
const CATEGORY_COLORS: Record<DeviceCategory, string> = {
  RAD: '#1d4ed8',
  ONT: '#1d4ed8',
  DSLAM: '#1d4ed8',
  ROUTER: '#4f46e5',
  MODEM: '#4f46e5',
  FIBER_MEDIA_CONVERTER: '#4f46e5',
  FIREWALL: '#1f2937',
  SWITCH: '#0d9488',
  ACCESS_POINT: '#0d9488',
  WIFI_EXTENDER: '#0d9488',
  WIRELESS_BRIDGE: '#0d9488',
  SERVER_RACK: '#7c3aed',
  PATCH_PANEL: '#7c3aed',
  UPS: '#7c3aed',
  COMPUTER: '#0891b2',
  PHONE: '#0891b2',
  TABLET: '#0891b2',
  PRINTER: '#0891b2',
  IOT_DEVICE: '#0891b2',
  BROWSER_CLIENT: '#2563eb',
  CUSTOM: '#6b7280',
};

const CATEGORY_ABBR: Record<DeviceCategory, string> = {
  RAD: 'RAD',
  ONT: 'ONT',
  DSLAM: 'DSL',
  ROUTER: 'RT',
  MODEM: 'MDM',
  FIBER_MEDIA_CONVERTER: 'FMC',
  FIREWALL: 'FW',
  SWITCH: 'SW',
  ACCESS_POINT: 'AP',
  WIFI_EXTENDER: 'WE',
  WIRELESS_BRIDGE: 'WB',
  SERVER_RACK: 'SRV',
  PATCH_PANEL: 'PP',
  UPS: 'UPS',
  COMPUTER: 'PC',
  PHONE: 'TEL',
  TABLET: 'TAB',
  PRINTER: 'PRN',
  IOT_DEVICE: 'IoT',
  BROWSER_CLIENT: 'WEB',
  CUSTOM: 'DEV',
};

export function getCategoryConfig(category: string) {
  return DEVICE_CATEGORY_CONFIG[category as DeviceCategory] ?? DEVICE_CATEGORY_CONFIG.CUSTOM;
}

export function createDeviceMarkerElement(
  device: DeviceDto,
  isSelected: boolean,
  onClick: () => void,
): HTMLDivElement {
  const category = device.category as DeviceCategory;
  const color = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.CUSTOM;
  const abbr = CATEGORY_ABBR[category] ?? 'DEV';

  const el = document.createElement('div');
  applyMarkerStyles(el, color, isSelected);
  el.textContent = abbr;
  el.title = device.name;
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return el;
}

function applyMarkerStyles(el: HTMLDivElement, color: string, isSelected: boolean): void {
  el.style.cssText = `
    width: ${isSelected ? '42px' : '36px'};
    height: ${isSelected ? '42px' : '36px'};
    border-radius: 50%;
    background: ${color};
    border: ${isSelected ? '3px' : '2px'} solid white;
    box-shadow: 0 2px 6px rgba(0,0,0,${isSelected ? '0.5' : '0.3'});
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 10px;
    font-weight: bold;
    font-family: sans-serif;
    transition: transform 0.1s, box-shadow 0.1s;
    transform: ${isSelected ? 'scale(1.1)' : 'scale(1)'};
    user-select: none;
  `;
}

export function updateDeviceMarkerSelected(el: HTMLDivElement, isSelected: boolean): void {
  el.style.width = isSelected ? '42px' : '36px';
  el.style.height = isSelected ? '42px' : '36px';
  el.style.border = `${isSelected ? '3px' : '2px'} solid white`;
  el.style.boxShadow = `0 2px 6px rgba(0,0,0,${isSelected ? '0.5' : '0.3'})`;
  el.style.transform = isSelected ? 'scale(1.1)' : 'scale(1)';
}
