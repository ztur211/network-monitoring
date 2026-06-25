import { describe, it, expect } from 'vitest';
import { filterDevices, emptyFilter } from '../filter-devices';
import type { DeviceDto } from '@nodescope/shared';

const dev = (over: Partial<DeviceDto>): DeviceDto => ({
  id: 'd',
  userId: null,
  networkId: 'n',
  propertyId: 'b',
  roleCode: null,
  name: 'Switch-1',
  category: 'SWITCH',
  latitude: null,
  longitude: null,
  floor: 1,
  floorLabel: null,
  x: null,
  y: null,
  z: null,
  ifcGlobalId: null,
  ipAddress: '10.0.0.5',
  macAddress: null,
  notes: null,
  version: 1,
  createdAt: '',
  updatedAt: '',
  ...over,
});

const statusOf = () => 'unknown' as const;

describe('filterDevices', () => {
  const ds = [
    dev({ id: 'a', name: 'Switch-1', category: 'SWITCH', x: 1, y: 2, z: 3 }),
    dev({ id: 'b', name: 'Router-9', category: 'ROUTER', networkId: 'n2', floor: 2 }),
  ];

  it('text matches name/ip', () =>
    expect(filterDevices(ds, { ...emptyFilter(), text: 'router' }, statusOf).map((d) => d.id)).toEqual(['b']));

  it('category filter', () =>
    expect(filterDevices(ds, { ...emptyFilter(), categories: new Set(['SWITCH']) }, statusOf).map((d) => d.id)).toEqual([
      'a',
    ]));

  it('placement: placed vs unplaced', () => {
    expect(filterDevices(ds, { ...emptyFilter(), placement: 'placed' }, statusOf).map((d) => d.id)).toEqual(['a']);
    expect(filterDevices(ds, { ...emptyFilter(), placement: 'unplaced' }, statusOf).map((d) => d.id)).toEqual(['b']);
  });

  it('network + floor', () =>
    expect(filterDevices(ds, { ...emptyFilter(), networkId: 'n2', floor: 2 }, statusOf).map((d) => d.id)).toEqual(['b']));

  it('status uses statusOf (all unknown in v1)', () => {
    expect(filterDevices(ds, { ...emptyFilter(), status: 'down' }, statusOf)).toHaveLength(0);
    expect(filterDevices(ds, { ...emptyFilter(), status: 'unknown' }, statusOf)).toHaveLength(2);
  });
});
