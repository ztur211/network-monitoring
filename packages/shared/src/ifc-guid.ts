export const IFC_B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

const MASK_128 = (1n << 128n) - 1n;

/** Deterministic 128-bit FNV-1a-style fold of an arbitrary seed (for derived entity GUIDs). */
function seedTo128(seed: string): bigint {
  let n = 0xcbf29ce484222325n;
  for (let i = 0; i < seed.length; i++) {
    n = ((n ^ BigInt(seed.charCodeAt(i))) * 0x100000001b3n) & MASK_128;
  }
  // fold the index in so distinct-length seeds spread further, then mask to 128 bits
  return (n ^ (BigInt(seed.length) << 64n)) & MASK_128;
}

/**
 * IFC GlobalId: 128 bits encoded MSB-first into 22 base-64 chars (the top char carries the leftover
 * 2 bits). A real UUID is encoded losslessly (exact 128 bits → stable, reversible — coordination diffs
 * in AEC tools work); any other seed (e.g. `${id}:pset`) is hashed deterministically. The device↔IFC
 * key reused by Spec 6 (BCF) is `toIfcGuid(device.id)` with a real UUID.
 */
export function toIfcGuid(seed: string): string {
  const hex = seed.replace(/-/g, '');
  let num = /^[0-9a-fA-F]{32}$/.test(hex) ? BigInt('0x' + hex) : seedTo128(seed);
  const out: string[] = [];
  for (let i = 0; i < 22; i++) {
    out.push(IFC_B64[Number(num % 64n)]);
    num /= 64n;
  }
  return out.reverse().join('');
}
