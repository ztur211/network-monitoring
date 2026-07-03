import { Readable } from 'node:stream';
import { StorageService, STORAGE_BACKEND } from '../storage.service';
import { Test } from '@nestjs/testing';

describe('StorageService (delegates to backend)', () => {
  const backend = {
    ensureReady: jest.fn(), put: jest.fn(), get: jest.fn(),
    delete: jest.fn(), exists: jest.fn(), list: jest.fn(),
  };
  let service: StorageService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const ref = await Test.createTestingModule({
      providers: [StorageService, { provide: STORAGE_BACKEND, useValue: backend }],
    }).compile();
    service = ref.get(StorageService);
  });

  it('builds an org/building/version key', () => {
    expect(service.buildVersionKey('o1', 'b1', 'v1')).toBe('org/o1/building/b1/v1.ifc');
  });

  it('putObjectStream delegates to backend.put', async () => {
    const body = Readable.from(Buffer.from('x'));
    await service.putObjectStream('k', body, 'image/png');
    expect(backend.put).toHaveBeenCalledWith('k', body, 'image/png');
  });

  it('getObjectStream / deleteObject / objectExists delegate', async () => {
    backend.exists.mockResolvedValue(true);
    await service.getObjectStream('k');
    await service.deleteObject('k');
    expect(await service.objectExists('k')).toBe(true);
    expect(backend.get).toHaveBeenCalledWith('k');
    expect(backend.delete).toHaveBeenCalledWith('k');
    expect(backend.exists).toHaveBeenCalledWith('k');
  });
});
