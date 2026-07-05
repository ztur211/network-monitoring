import { Readable } from 'node:stream';
import { ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { S3ObjectStore } from '../object-store';
import { offsiteConfigFromEnv } from '../config';

describe('offsiteConfigFromEnv', () => {
  it('returns null when pubkey or bucket is missing', () => {
    expect(offsiteConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(offsiteConfigFromEnv({ OFFSITE_BACKUP_PUBKEY: 'k' } as NodeJS.ProcessEnv)).toBeNull();
  });
  it('parses a full config with defaults', () => {
    const cfg = offsiteConfigFromEnv({
      OFFSITE_BACKUP_PUBKEY: 'PUB', OFFSITE_S3_BUCKET: 'b', OFFSITE_S3_ENDPOINT: 'http://x:9000',
      OFFSITE_S3_ACCESS_KEY: 'a', OFFSITE_S3_SECRET_KEY: 's',
    } as NodeJS.ProcessEnv)!;
    expect(cfg.pubkey).toBe('PUB');
    expect(cfg.prefix).toBe('nodescope');
    expect(cfg.keep).toBe(7);
    expect(cfg.includeBlobs).toBe(true);
    expect(cfg.s3.region).toBe('auto');
  });
  it('honors OFFSITE_INCLUDE_BLOBS=false and OFFSITE_KEEP', () => {
    const cfg = offsiteConfigFromEnv({
      OFFSITE_BACKUP_PUBKEY: 'P', OFFSITE_S3_BUCKET: 'b', OFFSITE_INCLUDE_BLOBS: 'false', OFFSITE_KEEP: '3',
    } as NodeJS.ProcessEnv)!;
    expect(cfg.includeBlobs).toBe(false);
    expect(cfg.keep).toBe(3);
  });
  it('falls back to keep=7 on a non-integer/garbage OFFSITE_KEEP', () => {
    const mk = (k: string) => offsiteConfigFromEnv({ OFFSITE_BACKUP_PUBKEY: 'P', OFFSITE_S3_BUCKET: 'b', OFFSITE_KEEP: k } as NodeJS.ProcessEnv)!.keep;
    expect(mk('3.7')).toBe(7);
    expect(mk('5abc')).toBe(7);
    expect(mk('0')).toBe(7);
    expect(mk('-1')).toBe(7);
    expect(mk('4')).toBe(4);
  });
  it('passes the full s3 config through', () => {
    const cfg = offsiteConfigFromEnv({
      OFFSITE_BACKUP_PUBKEY: 'P', OFFSITE_S3_BUCKET: 'bk', OFFSITE_S3_ENDPOINT: 'http://x:9000',
      OFFSITE_S3_ACCESS_KEY: 'ak', OFFSITE_S3_SECRET_KEY: 'sk', OFFSITE_S3_PREFIX: 'pfx',
    } as NodeJS.ProcessEnv)!;
    expect(cfg.s3).toEqual({ endpoint: 'http://x:9000', region: 'auto', bucket: 'bk', accessKey: 'ak', secretKey: 'sk' });
    expect(cfg.prefix).toBe('pfx');
  });
  it('returns null when pubkey is missing but bucket present', () => {
    expect(offsiteConfigFromEnv({ OFFSITE_S3_BUCKET: 'b' } as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('S3ObjectStore', () => {
  const send = jest.fn();
  const store = new S3ObjectStore({ send } as never, 'bucket');
  beforeEach(() => jest.clearAllMocks());

  it('get returns the Body stream', async () => {
    const body = Readable.from(Buffer.from('x'));
    send.mockResolvedValueOnce({ Body: body });
    expect(await store.get('k')).toBe(body);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
    expect((send.mock.calls[0][0] as GetObjectCommand).input).toMatchObject({ Bucket: 'bucket', Key: 'k' });
  });
  it('list returns sorted keys, paginating', async () => {
    send
      .mockResolvedValueOnce({ Contents: [{ Key: 'p/b' }, { Key: 'p/a' }], NextContinuationToken: 't' })
      .mockResolvedValueOnce({ Contents: [{ Key: 'p/c' }] });
    expect(await store.list('p/')).toEqual(['p/a', 'p/b', 'p/c']);
    expect(send.mock.calls[0][0]).toBeInstanceOf(ListObjectsV2Command);
    expect((send.mock.calls[0][0] as ListObjectsV2Command).input.Prefix).toBe('p/');
    expect((send.mock.calls[1][0] as ListObjectsV2Command).input.ContinuationToken).toBe('t');
  });
  it('del issues a DeleteObjectCommand', async () => {
    send.mockResolvedValueOnce({});
    await store.del('k');
    expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
    expect((send.mock.calls[0][0] as DeleteObjectCommand).input).toMatchObject({ Bucket: 'bucket', Key: 'k' });
  });
});
