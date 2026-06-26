import { buildNetworkIfc, ExportDevice } from '../ifc2x3-writer';
import { toIfcGuid } from '@nodescope/shared';

const dev = (over: Partial<ExportDevice>): ExportDevice => ({
  id: '11111111-1111-1111-1111-111111111111',
  x: 1.5,
  y: 2,
  z: 3,
  ...over,
});

describe('buildNetworkIfc', () => {
  it('emits IFC2x3 with one proxy per device and placements — no NodeScope property set', () => {
    const ifc = buildNetworkIfc({
      building: { id: '22222222-2222-2222-2222-222222222222', name: 'HQ' },
      storeyName: 'Network',
      devices: [
        dev({ id: '11111111-1111-1111-1111-111111111111' }),
        dev({ id: '33333333-3333-3333-3333-333333333333' }),
      ],
      timestamp: '2026-06-12T00:00:00Z',
    });
    expect(ifc.startsWith('ISO-10303-21;')).toBe(true);
    expect(ifc).toContain("FILE_SCHEMA(('IFC2X3'))");
    expect(ifc.match(/IFCBUILDINGELEMENTPROXY/g) ?? []).toHaveLength(2);
    expect(ifc).toContain('IFCCARTESIANPOINT((1.500000,2.000000,3.000000))');
    // No NodeScope property set emitted
    expect(ifc).not.toContain("'Pset_NodeScope'");
    expect(ifc).not.toContain('IFCPROPERTYSET');
    expect(ifc).not.toContain('IFCRELDEFINESBYPROPERTIES');
    expect(ifc.match(/IFCRELCONTAINEDINSPATIALSTRUCTURE/g) ?? []).toHaveLength(1); // one containment for all
    expect(ifc.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  });

  it('backslash-escapes the building name in BOTH the body and the FILE_NAME header', () => {
    const ifc = buildNetworkIfc({
      building: { id: '22222222-2222-2222-2222-222222222222', name: 'A\\B' }, // A, backslash, B
      storeyName: 'Network',
      devices: [],
      timestamp: '2026-06-12T00:00:00Z',
    });
    // Body already escaped correctly (A\\B); the header used to emit a raw lone backslash,
    // which in ISO-10303-21 starts a control directive → a malformed FILE_NAME.
    const fileNameLine = ifc.split('\n').find((l) => l.startsWith('FILE_NAME('))!;
    expect(fileNameLine).toContain('A\\\\B-network.ifc'); // escaped backslash
  });

  it('clamps extreme/non-finite coordinates so STEP REALs never use exponential notation', () => {
    const ifc = buildNetworkIfc({
      building: { id: '22222222-2222-2222-2222-222222222222', name: 'HQ' },
      storeyName: 'Network',
      devices: [dev({ x: 1e21, y: -1e30, z: NaN })],
      timestamp: '2026-06-12T00:00:00Z',
    });
    // (1e21).toFixed(6) === '1e+21' is an INVALID STEP REAL — no cartesian point may use exponents.
    const cartesian = ifc.split('\n').filter((l) => l.includes('IFCCARTESIANPOINT'));
    for (const l of cartesian) expect(l).not.toMatch(/e[+-]?\d/i);
    // Clamped to ±MAX_COORD (1e15) and NaN→0, all in plain decimal notation.
    expect(ifc).toContain('IFCCARTESIANPOINT((1000000000000000.000000,-1000000000000000.000000,0.000000))');
  });

  it('zero devices → a valid empty discipline stub', () => {
    const ifc = buildNetworkIfc({
      building: { id: '22222222-2222-2222-2222-222222222222', name: 'HQ' },
      storeyName: 'Network',
      devices: [],
      timestamp: '2026-06-12T00:00:00Z',
    });
    expect(ifc).toContain('IFCBUILDINGSTOREY');
    expect(ifc).not.toContain('IFCBUILDINGELEMENTPROXY');
  });

  // SECURITY REGRESSION: IFC export must be geometry+placement only — no NodeScope-specific data, no network-sensitive data
  it('SECURITY: output contains native GlobalId but ZERO NodeScope-specific or network-sensitive fields', () => {
    const deviceId = '11111111-1111-1111-1111-111111111111';
    const ifc = buildNetworkIfc({
      building: { id: '22222222-2222-2222-2222-222222222222', name: 'HQ' },
      storeyName: 'Network',
      devices: [dev({ id: deviceId, x: 1, y: 2, z: 3 })],
      timestamp: '2026-06-12T00:00:00Z',
    });
    // Native IFC GlobalId must survive (DB holds the device↔GlobalId association)
    expect(ifc).toContain(toIfcGuid(deviceId));
    expect(ifc).toContain('IFCBUILDINGELEMENTPROXY');
    // NodeScope-specific property set must be absent
    expect(ifc).not.toContain('NodeScopeId');
    expect(ifc).not.toContain('Pset_NodeScope');
    expect(ifc).not.toContain('IFCPROPERTYSET');
    expect(ifc).not.toContain('IFCRELDEFINESBYPROPERTIES');
    // Network-sensitive property labels must be absent
    expect(ifc).not.toContain('IPAddress');
    expect(ifc).not.toContain('MACAddress');
    // 'Network' as a property label (not part of file header/entity names)
    expect(ifc).not.toMatch(/IFCPROPERTYSINGLEVALUE\('Network'/);
    expect(ifc).not.toContain("'Category'");
  });
});
