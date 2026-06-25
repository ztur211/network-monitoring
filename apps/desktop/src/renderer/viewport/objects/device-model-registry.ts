export type ProcShape = 'rackbox' | 'tower' | 'dome' | 'smallbox' | 'slab' | 'generic';

export type DeviceModelSpec =
  | { kind: 'proc'; shape: ProcShape; size: [number, number, number] }
  | { kind: 'gltf'; url: string; scale: number }; // v2 seam: imported/online models

const SHAPE_BY_CATEGORY: Record<string, ProcShape> = {
  SWITCH: 'rackbox',
  ROUTER: 'rackbox',
  FIREWALL: 'rackbox',
  DSLAM: 'rackbox',
  RAD: 'rackbox',
  SERVER_RACK: 'tower',
  PATCH_PANEL: 'tower',
  UPS: 'tower',
  ACCESS_POINT: 'dome',
  WIFI_EXTENDER: 'dome',
  WIRELESS_BRIDGE: 'dome',
  ONT: 'smallbox',
  MODEM: 'smallbox',
  FIBER_MEDIA_CONVERTER: 'smallbox',
  IOT_DEVICE: 'smallbox',
  PHONE: 'slab',
  TABLET: 'slab',
  PRINTER: 'slab',
  COMPUTER: 'slab',
};

const SIZE_BY_SHAPE: Record<ProcShape, [number, number, number]> = {
  rackbox: [1.6, 0.4, 1.0],
  tower: [0.8, 2.0, 0.8],
  dome: [0.7, 0.35, 0.7],
  smallbox: [0.6, 0.3, 0.5],
  slab: [0.5, 0.06, 0.32],
  generic: [0.6, 0.6, 0.6],
};

export function modelForCategory(category: string): DeviceModelSpec {
  const shape = SHAPE_BY_CATEGORY[category] ?? 'generic';
  return { kind: 'proc', shape, size: SIZE_BY_SHAPE[shape] };
}
