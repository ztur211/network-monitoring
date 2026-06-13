// DeviceCategory mirrors the Prisma enum (apps/api/prisma/schema.prisma).
// Type-only re-export erases at compile time — no Prisma runtime in the web
// bundle. CLAUDE.md Rule #6 forbids hand-written duplicates of Prisma types.
import type { DeviceCategory, DeviceMobility } from '@prisma/client';
export type { DeviceCategory, DeviceMobility };

export interface DeviceCategoryConfig {
  minZoom: number;
  label: string;
}

export const DEVICE_CATEGORY_CONFIG: Record<DeviceCategory, DeviceCategoryConfig> = {
  RAD:                 { minZoom: 10, label: 'ISP Equipment' },
  ONT:                 { minZoom: 10, label: 'ISP Equipment' },
  DSLAM:               { minZoom: 10, label: 'ISP Equipment' },
  ROUTER:              { minZoom: 13, label: 'Core Infrastructure' },
  MODEM:               { minZoom: 13, label: 'Core Infrastructure' },
  FIBER_MEDIA_CONVERTER: { minZoom: 13, label: 'Core Infrastructure' },
  FIREWALL:            { minZoom: 13, label: 'Core Infrastructure' },
  SWITCH:              { minZoom: 16, label: 'Network Equipment' },
  ACCESS_POINT:        { minZoom: 16, label: 'Network Equipment' },
  WIFI_EXTENDER:       { minZoom: 16, label: 'Network Equipment' },
  WIRELESS_BRIDGE:     { minZoom: 16, label: 'Network Equipment' },
  SERVER_RACK:         { minZoom: 16, label: 'Network Equipment' },
  PATCH_PANEL:         { minZoom: 16, label: 'Network Equipment' },
  UPS:                 { minZoom: 16, label: 'Network Equipment' },
  COMPUTER:            { minZoom: 18, label: 'End-User Devices' },
  PHONE:               { minZoom: 18, label: 'End-User Devices' },
  TABLET:              { minZoom: 18, label: 'End-User Devices' },
  PRINTER:             { minZoom: 18, label: 'End-User Devices' },
  IOT_DEVICE:          { minZoom: 18, label: 'End-User Devices' },
  CUSTOM:              { minZoom: 16, label: 'Other' },
};
