import path from 'node:path';
import { storageConfig } from '../storage.config';

describe('storageConfig', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('defaults driver to s3', () => {
    delete process.env.STORAGE_DRIVER;
    expect(storageConfig().driver).toBe('s3');
  });

  it('reads driver=fs when set', () => {
    process.env.STORAGE_DRIVER = 'fs';
    expect(storageConfig().driver).toBe('fs');
  });

  it('defaults fsRoot under cwd/var/storage and honours STORAGE_FS_ROOT', () => {
    delete process.env.STORAGE_FS_ROOT;
    expect(storageConfig().fsRoot).toBe(path.resolve(process.cwd(), 'var/storage'));
    process.env.STORAGE_FS_ROOT = '/data/storage';
    expect(storageConfig().fsRoot).toBe('/data/storage');
  });
});
