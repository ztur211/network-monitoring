import { Readable } from 'node:stream';
import { generateKeypair, sealStream, unsealStream } from '../crypto';

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

describe('offsite crypto (hybrid sealed-box)', () => {
  it('round-trips: unseal(seal(x)) === x, across many chunks', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    const plain = Buffer.concat([Buffer.from('nodescope-offsite '), Buffer.alloc(200_000, 7)]);
    // feed the input in several arbitrary-sized chunks
    const input = Readable.from((function* () {
      yield plain.subarray(0, 10);
      yield plain.subarray(10, 70_000);
      yield plain.subarray(70_000);
    })());
    const sealed = await collect(sealStream(publicKey, input));
    expect(sealed.subarray(0, 5).toString()).toBe('NSOB1');
    expect(sealed.equals(plain)).toBe(false); // it's encrypted
    const out = await collect(unsealStream(publicKey, privateKey, Readable.from(sealed)));
    expect(out.equals(plain)).toBe(true);
  });

  it('detects tampering (a flipped ciphertext byte fails)', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    const sealed = await collect(sealStream(publicKey, Readable.from(Buffer.from('secret payload'))));
    sealed[sealed.length - 3] ^= 0xff; // corrupt a frame
    await expect(collect(unsealStream(publicKey, privateKey, Readable.from(sealed)))).rejects.toThrow();
  });

  it('rejects the wrong identity', async () => {
    const a = await generateKeypair();
    const b = await generateKeypair();
    const sealed = await collect(sealStream(a.publicKey, Readable.from(Buffer.from('for A only'))));
    await expect(collect(unsealStream(b.publicKey, b.privateKey, Readable.from(sealed)))).rejects.toThrow();
  });

  it('detects truncation (missing FINAL frame)', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    const sealed = await collect(sealStream(publicKey, Readable.from(Buffer.alloc(1000, 1))));
    const truncated = sealed.subarray(0, sealed.length - 10); // drop the tail
    await expect(collect(unsealStream(publicKey, privateKey, Readable.from(truncated)))).rejects.toThrow();
  });

  it('decrypts when the ciphertext is fed one byte per source chunk (cross-chunk parser)', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    const plain = Buffer.alloc(2000, 3);
    const sealed = await collect(sealStream(publicKey, Readable.from(plain)));
    const drip = Readable.from((function* () { for (const b of sealed) yield Buffer.from([b]); })());
    const out = await collect(unsealStream(publicKey, privateKey, drip));
    expect(out.equals(plain)).toBe(true);
  });

  it('rejects a forged oversized frame length before allocating', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    const sealed = await collect(sealStream(publicKey, Readable.from(Buffer.from('hi'))));
    // walk the header to the first frame's u32 length prefix, then forge it huge
    let o = 5; // MAGIC
    const sealedLen = sealed.readUInt16BE(o); o += 2 + sealedLen;
    const headerLen = sealed.readUInt16BE(o); o += 2 + headerLen;
    sealed.writeUInt32BE(0xffffffff, o);
    await expect(collect(unsealStream(publicKey, privateKey, Readable.from(sealed)))).rejects.toThrow(/exceeds|cap|too large/i);
  });
});
