import { Test } from '@nestjs/testing';
import { StorageService, S3_CLIENT } from '../storage.service';
import { HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

describe('StorageService (unit, mocked S3)', () => {
  let service: StorageService;
  const send = jest.fn();
  const fakeClient = { send } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const ref = await Test.createTestingModule({
      providers: [StorageService, { provide: S3_CLIENT, useValue: fakeClient }],
    }).compile();
    service = ref.get(StorageService);
  });

  it('builds an org/building/version key', () => {
    expect(service.buildVersionKey('o1', 'b1', 'v1')).toBe('org/o1/building/b1/v1.ifc');
  });

  it('objectExists is false when HEAD throws (404)', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('NotFound'), { name: 'NotFound' }));
    expect(await service.objectExists('k')).toBe(false);
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
  });

  it('objectExists is true when HEAD resolves', async () => {
    send.mockResolvedValueOnce({});
    expect(await service.objectExists('k')).toBe(true);
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
  });

  it('deleteObject issues a DeleteObjectCommand', async () => {
    send.mockResolvedValueOnce({});
    await service.deleteObject('k');
    expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
  });
});
