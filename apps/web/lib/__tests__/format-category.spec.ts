/**
 * Characterization test for formatDeviceCategory — the single source of
 * truth for device-category display labels, consolidated from four
 * duplicated copies (DeviceForm, equipment.tsx, DeviceDetailPanel,
 * MapControls). Two of those copies title-cased via regex
 * (e.g. IOT_DEVICE -> "Iot Device"); this pins the nicer, explicit labels
 * (e.g. IOT_DEVICE -> "IoT Device") that DeviceForm/equipment already used.
 */
import type { DeviceCategory } from '@nodescope/shared';
import { formatDeviceCategory } from '../format-category';

describe('formatDeviceCategory', () => {
  const cases: [DeviceCategory, string][] = [
    ['ROUTER', 'Router'],
    ['SWITCH', 'Switch'],
    ['ACCESS_POINT', 'Access Point'],
    ['FIREWALL', 'Firewall'],
    ['MODEM', 'Modem'],
    ['ONT', 'ONT'],
    ['RAD', 'RAD'],
    ['DSLAM', 'DSLAM'],
    ['FIBER_MEDIA_CONVERTER', 'Fiber Converter'],
    ['WIFI_EXTENDER', 'Wi-Fi Extender'],
    ['WIRELESS_BRIDGE', 'Wireless Bridge'],
    ['SERVER_RACK', 'Server Rack'],
    ['PATCH_PANEL', 'Patch Panel'],
    ['UPS', 'UPS'],
    ['COMPUTER', 'Computer'],
    ['PHONE', 'Phone'],
    ['TABLET', 'Tablet'],
    ['PRINTER', 'Printer'],
    ['IOT_DEVICE', 'IoT Device'],
    ['CUSTOM', 'Custom'],
  ];

  it.each(cases)('maps %s to "%s"', (category, label) => {
    expect(formatDeviceCategory(category)).toBe(label);
  });

  it('falls back to the raw value for an unknown category string', () => {
    expect(formatDeviceCategory('LEGACY_THING')).toBe('LEGACY_THING');
  });
});
