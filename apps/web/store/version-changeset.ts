export interface ChangesetChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

/**
 * Diffs a partial `input` against the `original` entity and returns one
 * ChangesetChange per field whose value actually changed (strict `!==`). This
 * is the client half of the optimistic-concurrency PATCH protocol — the
 * resulting changes array is sent alongside `baseVersion`.
 *
 * Extracted from device.store / circuits.store, whose updateX methods built
 * this diff with identical loops. Each store keeps its own caller-side
 * "no changes -> return original" short-circuit.
 */
export function buildVersionedChangeset<T>(
  original: T,
  input: Partial<Record<keyof T, unknown>>,
): ChangesetChange[] {
  const changes: ChangesetChange[] = [];
  for (const [field, newValue] of Object.entries(input)) {
    const oldValue = (original as Record<string, unknown>)[field];
    if (oldValue !== newValue) {
      changes.push({ field, oldValue, newValue });
    }
  }
  return changes;
}
