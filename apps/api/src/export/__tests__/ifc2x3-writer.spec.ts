import { buildNetworkIfc, ExportDevice } from '../ifc2x3-writer';

const dev = (over: Partial<ExportDevice>): ExportDevice => ({
  id: '11111111-1111-1111-1111-111111111111',
  x: 1.5,
  y: 2,
  z: 3,
  ...over,
});

describe('buildNetworkIfc', () => {
  it('emits IFC2x3 with one proxy per device, placements, and Pset_NodeScope', () => {
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
    expect(ifc).toContain("'Pset_NodeScope'");
    expect(ifc.match(/IFCRELCONTAINEDINSPATIALSTRUCTURE/g) ?? []).toHaveLength(1); // one containment for all
    expect(ifc.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
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

  // SECURITY REGRESSION: IFC export must be geometry+placement+pointer only — no network-sensitive data
  it('SECURITY: output contains NodeScopeId pointer but ZERO network-sensitive fields', () => {
    const sensitiveId = '11111111-1111-1111-1111-111111111111';
    const ifc = buildNetworkIfc({
      building: { id: '22222222-2222-2222-2222-222222222222', name: 'HQ' },
      storeyName: 'Network',
      devices: [dev({ id: sensitiveId, x: 1, y: 2, z: 3 })],
      timestamp: '2026-06-12T00:00:00Z',
    });
    // Pointer must survive (re-association)
    expect(ifc).toContain('NodeScopeId');
    expect(ifc).toContain(sensitiveId);
    // Network-sensitive property labels must be absent
    expect(ifc).not.toContain('IPAddress');
    expect(ifc).not.toContain('MACAddress');
    // 'Network' as a property label (not part of file header/entity names)
    expect(ifc).not.toMatch(/IFCPROPERTYSINGLEVALUE\('Network'/);
    expect(ifc).not.toContain("'Category'");
  });
});
