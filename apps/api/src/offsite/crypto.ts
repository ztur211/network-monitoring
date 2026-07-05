import { Readable } from 'node:stream';
import _sodium from 'libsodium-wrappers';

export const MAGIC = Buffer.from('NSOB1');

// Seal emits normal Node stream chunks; a frame far larger than that means a
// corrupt or hostile ciphertext — reject it before allocating (untrusted input).
const MAX_FRAME = 64 * 1024 * 1024;

async function sodium(): Promise<typeof _sodium> {
  await _sodium.ready;
  return _sodium;
}

const B64 = (s: typeof _sodium) => s.base64_variants.ORIGINAL;

export async function generateKeypair(): Promise<{ publicKey: string; privateKey: string }> {
  const s = await sodium();
  const kp = s.crypto_box_keypair();
  return { publicKey: s.to_base64(kp.publicKey, B64(s)), privateKey: s.to_base64(kp.privateKey, B64(s)) };
}

function u16(n: number): Buffer { const b = Buffer.allocUnsafe(2); b.writeUInt16BE(n); return b; }
function u32(n: number): Buffer { const b = Buffer.allocUnsafe(4); b.writeUInt32BE(n); return b; }

/** Encrypt `input` to the recipient's public key. Emits the NSOB1 framing. */
export function sealStream(recipientPublicKeyB64: string, input: Readable): Readable {
  return Readable.from((async function* () {
    const s = await sodium();
    const pub = s.from_base64(recipientPublicKeyB64, B64(s));
    const dataKey = s.crypto_secretstream_xchacha20poly1305_keygen();
    const { state, header } = s.crypto_secretstream_xchacha20poly1305_init_push(dataKey);
    const sealedKey = s.crypto_box_seal(dataKey, pub);
    // header block
    yield MAGIC;
    yield u16(sealedKey.length); yield Buffer.from(sealedKey);
    yield u16(header.length); yield Buffer.from(header);
    // data frames (each input chunk → one MESSAGE frame)
    for await (const chunk of input) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const ct = s.crypto_secretstream_xchacha20poly1305_push(
        state, buf, null, s.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
      );
      yield u32(ct.length); yield Buffer.from(ct);
    }
    // trailing empty FINAL frame marks completion
    const fin = s.crypto_secretstream_xchacha20poly1305_push(
      state, new Uint8Array(0), null, s.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
    );
    yield u32(fin.length); yield Buffer.from(fin);
  })());
}

/** Decrypt an NSOB1 stream. Throws on wrong key, tamper, or truncation. */
export function unsealStream(publicKeyB64: string, privateKeyB64: string, input: Readable): Readable {
  return Readable.from((async function* () {
    const s = await sodium();
    const pub = s.from_base64(publicKeyB64, B64(s));
    const priv = s.from_base64(privateKeyB64, B64(s));

    let buf = Buffer.alloc(0);
    const it = input[Symbol.asyncIterator]();
    // read at least `n` bytes into `buf`, pulling from the source; throws if the stream ends first
    async function need(n: number): Promise<void> {
      while (buf.length < n) {
        const { value, done } = await it.next();
        if (done) throw new Error('offsite: truncated ciphertext (unexpected end of stream)');
        buf = Buffer.concat([buf, Buffer.isBuffer(value) ? value : Buffer.from(value)]);
      }
    }
    function take(n: number): Buffer { const out = buf.subarray(0, n); buf = buf.subarray(n); return out; }

    await need(5);
    if (!take(5).equals(MAGIC)) throw new Error('offsite: bad magic (not an NSOB1 backup)');
    await need(2); const sealedLen = take(2).readUInt16BE();
    await need(sealedLen); const sealedKey = take(sealedLen);
    await need(2); const headerLen = take(2).readUInt16BE();
    await need(headerLen); const header = take(headerLen);

    let dataKey: Uint8Array | false;
    try { dataKey = s.crypto_box_seal_open(sealedKey, pub, priv); } catch { dataKey = false; }
    if (!dataKey) throw new Error('offsite: cannot open sealed data key (wrong identity or corrupt header)');
    const state = s.crypto_secretstream_xchacha20poly1305_init_pull(header, dataKey);

    for (;;) {
      await need(4); const frameLen = take(4).readUInt32BE();
      if (frameLen > MAX_FRAME) throw new Error('offsite: frame length exceeds cap (corrupt or hostile ciphertext)');
      await need(frameLen); const frame = take(frameLen);
      const res = s.crypto_secretstream_xchacha20poly1305_pull(state, frame, null);
      if (!res) throw new Error('offsite: ciphertext authentication failed (tampered or corrupt)');
      if (res.message.length) yield Buffer.from(res.message);
      if (res.tag === s.crypto_secretstream_xchacha20poly1305_TAG_FINAL) return;
    }
  })());
}
