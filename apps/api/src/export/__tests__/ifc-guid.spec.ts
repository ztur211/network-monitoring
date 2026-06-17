import { toIfcGuid, IFC_B64 } from '../ifc-guid';

describe('toIfcGuid', () => {
  const uuid = '12345678-1234-5678-1234-567812345678';

  it('produces a deterministic 22-char GUID over the IFC alphabet', () => {
    const g = toIfcGuid(uuid);
    expect(g).toHaveLength(22);
    expect([...g].every((c) => IFC_B64.includes(c))).toBe(true);
    expect(toIfcGuid(uuid)).toBe(g); // deterministic
  });

  it('encodes the full 128 bits (decodes back to the uuid)', () => {
    let n = 0n;
    for (const c of toIfcGuid(uuid)) n = n * 64n + BigInt(IFC_B64.indexOf(c));
    expect(n.toString(16).padStart(32, '0')).toBe(uuid.replace(/-/g, ''));
  });

  it('different uuids → different guids', () => {
    expect(toIfcGuid(uuid)).not.toBe(toIfcGuid('00000000-0000-0000-0000-000000000001'));
  });
});
