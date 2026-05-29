/**
 * Unit tests for upsertById — the shared list-upsert reducer extracted from
 * device.store / circuits.store, whose upsertX reducers had identical
 * find-replace-or-append logic. Pins: append when the id is new, replace in
 * place (preserving order) when it exists, and never mutate the input array.
 */
import { upsertById } from '../upsert-by-id';

describe('upsertById', () => {
  it('appends when no entry shares the id', () => {
    const list = [{ id: 'a', n: 1 }];
    expect(upsertById(list, { id: 'b', n: 2 })).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ]);
  });

  it('replaces the existing entry in place, preserving order', () => {
    const list = [
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
      { id: 'c', n: 3 },
    ];
    expect(upsertById(list, { id: 'b', n: 20 })).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 20 },
      { id: 'c', n: 3 },
    ]);
  });

  it('does not mutate the input array', () => {
    const list = [{ id: 'a', n: 1 }];
    const snapshot = [...list];
    upsertById(list, { id: 'a', n: 99 });
    expect(list).toEqual(snapshot);
  });

  it('returns a new array reference even when replacing', () => {
    const list = [{ id: 'a', n: 1 }];
    expect(upsertById(list, { id: 'a', n: 2 })).not.toBe(list);
  });

  it('upserts into an empty list', () => {
    expect(upsertById([] as { id: string }[], { id: 'a' })).toEqual([{ id: 'a' }]);
  });
});
