/**
 * Unit tests for buildVersionedChangeset — the client-side optimistic-
 * concurrency diff extracted from device.store / circuits.store, whose
 * updateX methods built this diff with identical loops. Pins: only changed
 * fields are emitted, the {field, oldValue, newValue} shape, that null is a
 * distinct value (clearing a field counts), and the empty-changeset case.
 */
import { buildVersionedChangeset } from '../version-changeset';

describe('buildVersionedChangeset', () => {
  it('emits one change per field whose value differs', () => {
    const original = { name: 'old', notes: 'keep', floor: 1 };
    expect(buildVersionedChangeset(original, { name: 'new', notes: 'keep' })).toEqual([
      { field: 'name', oldValue: 'old', newValue: 'new' },
    ]);
  });

  it('captures oldValue and newValue for each changed field, in input order', () => {
    const original = { a: 1, b: 2 };
    expect(buildVersionedChangeset(original, { a: 10, b: 20 })).toEqual([
      { field: 'a', oldValue: 1, newValue: 10 },
      { field: 'b', oldValue: 2, newValue: 20 },
    ]);
  });

  it('treats null as a distinct value (clearing a field is a change)', () => {
    const original = { notes: 'something' };
    expect(buildVersionedChangeset(original, { notes: null })).toEqual([
      { field: 'notes', oldValue: 'something', newValue: null },
    ]);
  });

  it('returns an empty array when nothing changed', () => {
    const original = { name: 'same', floor: 2 };
    expect(buildVersionedChangeset(original, { name: 'same', floor: 2 })).toEqual([]);
  });

  it('reads oldValue as undefined for a field absent on the original', () => {
    const original: { name: string; extra?: string } = { name: 'x' };
    expect(buildVersionedChangeset(original, { extra: 'added' })).toEqual([
      { field: 'extra', oldValue: undefined, newValue: 'added' },
    ]);
  });
});
