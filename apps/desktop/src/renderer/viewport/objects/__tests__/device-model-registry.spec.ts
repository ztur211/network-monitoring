import { describe, it, expect } from 'vitest';
import { modelForCategory } from '../device-model-registry';

describe('modelForCategory', () => {
  it('maps categories to recognizable shapes', () => {
    expect(modelForCategory('SWITCH')).toMatchObject({ kind: 'proc', shape: 'rackbox' });
    expect(modelForCategory('ACCESS_POINT')).toMatchObject({ shape: 'dome' });
    expect(modelForCategory('SERVER_RACK')).toMatchObject({ shape: 'tower' });
    expect(modelForCategory('ONT')).toMatchObject({ shape: 'smallbox' });
    expect(modelForCategory('PHONE')).toMatchObject({ shape: 'slab' });
  });

  it('unknown/CUSTOM category → generic', () => {
    expect(modelForCategory('CUSTOM')).toMatchObject({ shape: 'generic' });
    expect(modelForCategory('NONSENSE')).toMatchObject({ shape: 'generic' });
  });

  it('every spec carries a positive size triple', () => {
    const s = modelForCategory('ROUTER');
    expect(s.kind).toBe('proc');
    if (s.kind === 'proc') expect(s.size.every((n) => n > 0)).toBe(true);
  });
});
