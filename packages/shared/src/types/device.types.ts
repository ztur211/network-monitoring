// DeviceCategory/DeviceMobility mirror the database enum labels, owned by the
// C# API since the Decision 11 cutover (src/NodeScope.Migrations). Literal
// unions here — the Prisma client these were re-exported from left with the
// Node API; the transition-era web/desktop clients retire with step 5.
export type DeviceCategory =
  | 'RAD' | 'ONT' | 'DSLAM' | 'ROUTER' | 'MODEM' | 'FIBER_MEDIA_CONVERTER'
  | 'FIREWALL' | 'SWITCH' | 'ACCESS_POINT' | 'WIFI_EXTENDER' | 'WIRELESS_BRIDGE'
  | 'SERVER_RACK' | 'PATCH_PANEL' | 'UPS' | 'COMPUTER' | 'PHONE' | 'TABLET'
  | 'PRINTER' | 'IOT_DEVICE' | 'CUSTOM';
export type DeviceMobility = 'HOME_ONLY' | 'ROAMS' | 'UNKNOWN';

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
