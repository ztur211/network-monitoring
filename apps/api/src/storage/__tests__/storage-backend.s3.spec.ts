import { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { S3StorageBackend } from '../storage-backend.s3';

describe('S3StorageBackend', () => {
  const send = jest.fn();
  const destroy = jest.fn();
  const s3 = { send, destroy } as any;
  let backend: S3StorageBackend;

  beforeEach(() => {
    jest.clearAllMocks();
    backend = new S3StorageBackend(s3, 'nodescope');
  });

  it('ensureReady swallows BucketAlreadyOwnedByYou', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error(), { name: 'BucketAlreadyOwnedByYou' }));
    await expect(backend.ensureReady()).resolves.toBeUndefined();
    expect(send.mock.calls[0][0]).toBeInstanceOf(CreateBucketCommand);
  });

  it('get issues a GetObjectCommand and returns the Body stream', async () => {
    const body = Readable.from(Buffer.from('x'));
    send.mockResolvedValueOnce({ Body: body });
    expect(await backend.get('k')).toBe(body);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
  });

  it('exists is true/false from HeadObjectCommand', async () => {
    send.mockResolvedValueOnce({});
    expect(await backend.exists('k')).toBe(true);
    send.mockRejectedValueOnce(Object.assign(new Error(), { name: 'NotFound' }));
    expect(await backend.exists('k')).toBe(false);
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
  });

  it('delete issues a DeleteObjectCommand', async () => {
    send.mockResolvedValueOnce({});
    await backend.delete('k');
    expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('list paginates ListObjectsV2 and returns keys', async () => {
    send
      .mockResolvedValueOnce({ Contents: [{ Key: 'a' }, { Key: 'b' }], IsTruncated: true, NextContinuationToken: 't' })
      .mockResolvedValueOnce({ Contents: [{ Key: 'c' }], IsTruncated: false });
    expect(await backend.list()).toEqual(['a', 'b', 'c']);
    expect(send.mock.calls[0][0]).toBeInstanceOf(ListObjectsV2Command);
    expect(send.mock.calls[1][0].input.ContinuationToken).toBe('t');
  });

  it('destroys the S3 HTTP client on shutdown', async () => {
    await backend.close();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
