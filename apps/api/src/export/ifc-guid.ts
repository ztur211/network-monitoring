export const IFC_B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/**
 * IFC GlobalId: the 128-bit UUID encoded MSB-first into 22 base-64 chars (the top char carries the
 * leftover 2 bits). Deterministic + lossless, so re-exports produce stable GlobalIds (coordination
 * diffs in AEC tools work). Also the device↔IFC-element key reused by Spec 6 (BCF).
 */
export function toIfcGuid(uuid: string): string {
  let num = BigInt('0x' + uuid.replace(/-/g, ''));
  const out: string[] = [];
  for (let i = 0; i < 22; i++) {
    out.push(IFC_B64[Number(num % 64n)]);
    num /= 64n;
  }
  return out.reverse().join('');
}
