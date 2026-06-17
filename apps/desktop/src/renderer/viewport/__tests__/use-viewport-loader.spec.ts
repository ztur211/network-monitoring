import { describe, it, expect, vi } from 'vitest';
import { loadBuilding, createModelCache } from '../use-viewport-loader';

const fakeModel = (id = 'm') => ({ id, dispose: vi.fn() }) as any;

const harness = (over: any = {}) => {
  const status: any[] = [];
  let model: any = null;
  return {
    status,
    get model() {
      return model;
    },
    opts: {
      propertyId: 'b1',
      isCurrent: () => true,
      setStatus: (s: string, e?: string) => status.push([s, e ?? null]),
      setModel: (m: any) => {
        model = m;
      },
      cache: createModelCache(),
      rest: {
        getBuildingModel: vi.fn().mockResolvedValue({ model: { id: 'bm' }, activeVersion: { id: 'v1' } }),
        getActiveModelFile: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      },
      loader: { loadModel: vi.fn().mockResolvedValue(fakeModel()) },
      ...over,
    },
  };
};

describe('loadBuilding', () => {
  it('happy path: loading → parsing → ready with a model', async () => {
    const h = harness();
    await loadBuilding(h.opts as any);
    expect(h.status.map((s) => s[0])).toEqual(['loading', 'parsing', 'ready']);
    expect(h.model).toBeTruthy();
  });

  it('MODEL_001 → empty (no download/parse)', async () => {
    const h = harness({
      rest: {
        getBuildingModel: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error('none'), { code: 'MODEL_001' })),
        getActiveModelFile: vi.fn(),
      },
    });
    await loadBuilding(h.opts as any);
    expect(h.status.map((s) => s[0])).toEqual(['loading', 'empty']);
    expect(h.opts.rest.getActiveModelFile).not.toHaveBeenCalled();
  });

  it('parse failure → error, never throws', async () => {
    const h = harness({ loader: { loadModel: vi.fn().mockRejectedValue(new Error('bad ifc')) } });
    await expect(loadBuilding(h.opts as any)).resolves.toBeUndefined();
    expect(h.status.at(-1)![0]).toBe('error');
  });

  it('stale resolve is discarded and the model disposed', async () => {
    const m = fakeModel();
    let stale = false; // becomes stale while parsing → the post-loadModel guard disposes it
    const h = harness({
      isCurrent: () => !stale,
      loader: {
        loadModel: vi.fn().mockImplementation(async () => {
          stale = true;
          return m;
        }),
      },
    });
    await loadBuilding(h.opts as any);
    expect(h.model).toBeNull();
    expect(m.dispose).toHaveBeenCalled();
  });

  it('cache hit restores instantly without re-downloading', async () => {
    const cache = createModelCache();
    const m = fakeModel('cached');
    cache.put('b1', m);
    const h = harness({ cache });
    await loadBuilding(h.opts as any);
    expect(h.model).toBe(m);
    expect(h.opts.rest.getBuildingModel).not.toHaveBeenCalled();
  });
});

describe('createModelCache (keep-last-1)', () => {
  it('evicts and disposes the previous entry', () => {
    const cache = createModelCache();
    const a = fakeModel('a');
    const b = fakeModel('b');
    cache.put('a', a);
    cache.put('b', b); // putting b evicts a
    expect(a.dispose).toHaveBeenCalled();
    expect(cache.take('b')).toBe(b);
    expect(cache.take('a')).toBeNull();
  });
});
