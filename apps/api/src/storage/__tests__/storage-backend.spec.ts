import path from 'node:path';
import { resolveKeyPath } from '../storage-backend';

describe('resolveKeyPath', () => {
  const root = '/srv/storage';

  it('resolves a normal hierarchical key under root', () => {
    expect(resolveKeyPath(root, 'org/o1/building/b1/v1.ifc')).toBe(
      path.join(root, 'org/o1/building/b1/v1.ifc'),
    );
  });

  it.each([
    'org/../../etc/passwd',
    '../secret',
    '/absolute/key',
    'org/./x',
    'org//x',
    'a\0b',
  ])('rejects unsafe key %p', (key) => {
    expect(() => resolveKeyPath(root, key)).toThrow('INVALID_STORAGE_KEY');
  });
});
