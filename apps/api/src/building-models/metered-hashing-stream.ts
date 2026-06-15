import { Transform, TransformCallback } from 'node:stream';
import { createHash, Hash } from 'node:crypto';

export class UploadTooLargeError extends Error {}
export class InvalidIfcError extends Error {}

const IFC_MAGIC = 'ISO-10303-21;';

/**
 * A pass-through Transform that, while streaming bytes to the bucket, enforces a max
 * size and the IFC magic prefix (ISO-10303-21;) and computes the sha256 + byte count.
 * Spec 1 §7: the upload is never buffered whole — validation happens inline.
 */
export function meteredHashingStream(maxBytes: number): {
  transform: Transform;
  result: () => { contentHash: string; sizeBytes: number };
} {
  const hash: Hash = createHash('sha256');
  let size = 0;
  let head = Buffer.alloc(0);
  let magicChecked = false;

  const transform = new Transform({
    transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
      size += chunk.length;
      if (size > maxBytes) return cb(new UploadTooLargeError());
      if (!magicChecked) {
        head = Buffer.concat([head, chunk]);
        if (head.length >= IFC_MAGIC.length) {
          magicChecked = true;
          if (!head.toString('latin1', 0, IFC_MAGIC.length).startsWith(IFC_MAGIC)) {
            return cb(new InvalidIfcError());
          }
        }
      }
      hash.update(chunk);
      cb(null, chunk);
    },
    flush(cb: TransformCallback) {
      // a stream shorter than the magic prefix never validated → reject
      if (!magicChecked) return cb(new InvalidIfcError());
      cb();
    },
  });

  return { transform, result: () => ({ contentHash: hash.digest('hex'), sizeBytes: size }) };
}
