import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { meteredHashingStream, UploadTooLargeError, InvalidIfcError } from '../metered-hashing-stream';

async function drain(src: Readable): Promise<void> {
  return new Promise((res, rej) => {
    src.on('data', () => {});
    src.on('end', res);
    src.on('error', rej);
  });
}

describe('meteredHashingStream', () => {
  it('passes a valid IFC through and reports sha256 + size', async () => {
    const body = Buffer.from('ISO-10303-21;\nHEADER;\n... rest ...');
    const { transform, result } = meteredHashingStream(1_000);
    Readable.from([body]).pipe(transform);
    await drain(transform);
    const r = result();
    expect(r.sizeBytes).toBe(body.length);
    expect(r.contentHash).toBe(createHash('sha256').update(body).digest('hex'));
  });

  it('errors with UploadTooLargeError past the cap', async () => {
    const { transform } = meteredHashingStream(4);
    Readable.from([Buffer.from('ISO-10303-21; way too long')]).pipe(transform);
    await expect(drain(transform)).rejects.toBeInstanceOf(UploadTooLargeError);
  });

  it('errors with InvalidIfcError when the magic prefix is wrong', async () => {
    const { transform } = meteredHashingStream(1_000);
    Readable.from([Buffer.from('NOT-AN-IFC-FILE-AT-ALL')]).pipe(transform);
    await expect(drain(transform)).rejects.toBeInstanceOf(InvalidIfcError);
  });

  it('errors with InvalidIfcError when the stream is shorter than the magic prefix', async () => {
    const { transform } = meteredHashingStream(1_000);
    Readable.from([Buffer.from('ISO')]).pipe(transform);
    await expect(drain(transform)).rejects.toBeInstanceOf(InvalidIfcError);
  });
});
