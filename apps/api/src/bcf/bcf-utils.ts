/** Shared BCF utility functions. */

/** Minimum PNG header (8 bytes): \x89PNG\r\n\x1a\n */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Returns true if the buffer begins with the 8-byte PNG magic signature.
 * A zero-length buffer (empty snapshot) returns false.
 */
export function isPng(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_MAGIC[i]) return false;
  }
  return true;
}
