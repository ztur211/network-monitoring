import { DeviceCategory } from '@prisma/client';

const ROLE_CODES: Partial<Record<DeviceCategory, string>> = {
  // ISP Equipment
  RAD: 'rad',
  ONT: 'ont',
  DSLAM: 'dslam',

  // Core Infrastructure
  ROUTER: 'rtr',
  MODEM: 'modem',
  FIBER_MEDIA_CONVERTER: 'fmc',
  FIREWALL: 'fw',

  // Network Equipment
  SWITCH: 'sw',
  ACCESS_POINT: 'ap',
  WIFI_EXTENDER: 'wx',
  WIRELESS_BRIDGE: 'wb',
  SERVER_RACK: 'rack',
  PATCH_PANEL: 'pp',
  UPS: 'ups',

  // End-User Devices
  COMPUTER: 'pc',
  PHONE: 'phone',
  TABLET: 'tablet',
  PRINTER: 'printer',
  IOT_DEVICE: 'iot',

  // Other
  CUSTOM: 'custom',
};

export function roleCodeOf(category: DeviceCategory): string {
  return ROLE_CODES[category] ?? String(category).toLowerCase();
}
