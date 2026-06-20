import type { DeviceCategory } from '@nodescope/shared';

/**
 * Display labels for device categories — the single source of truth,
 * consolidated from four duplicated copies (DeviceForm, equipment.tsx,
 * DeviceDetailPanel, MapControls). Exhaustive over the Prisma DeviceCategory
 * enum, so adding a new category fails the build here until a label exists.
 */
const CATEGORY_LABELS: Record<DeviceCategory, string> = {
  RAD: 'RAD',
  ONT: 'ONT',
  DSLAM: 'DSLAM',
  ROUTER: 'Router',
  MODEM: 'Modem',
  FIBER_MEDIA_CONVERTER: 'Fiber Converter',
  FIREWALL: 'Firewall',
  SWITCH: 'Switch',
  ACCESS_POINT: 'Access Point',
  WIFI_EXTENDER: 'Wi-Fi Extender',
  WIRELESS_BRIDGE: 'Wireless Bridge',
  SERVER_RACK: 'Server Rack',
  PATCH_PANEL: 'Patch Panel',
  UPS: 'UPS',
  COMPUTER: 'Computer',
  PHONE: 'Phone',
  TABLET: 'Tablet',
  PRINTER: 'Printer',
  IOT_DEVICE: 'IoT Device',
  CUSTOM: 'Custom',
};

/**
 * Human-readable label for a device category. Accepts a plain string (DTOs
 * type `category` as string) and falls back to the raw value for any
 * unrecognized category so legacy/unknown values still render.
 */
export function formatDeviceCategory(category: string): string {
  return CATEGORY_LABELS[category as DeviceCategory] ?? category;
}
