/**
 * Inserts `item` into `list`, or replaces the existing entry that shares its
 * `id`. Returns a new array (never mutates `list`), so it is safe to hand
 * straight to a Zustand `set`.
 *
 * Extracted from device.store / circuits.store, whose upsertX reducers had
 * identical find-replace-or-append logic.
 */
export function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((entry) => entry.id === item.id);
  if (idx === -1) return [...list, item];
  const next = [...list];
  next[idx] = item;
  return next;
}
