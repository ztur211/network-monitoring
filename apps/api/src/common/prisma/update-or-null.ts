/**
 * Run an optimistic-locked Prisma `update` (whose `where` includes the expected `version`)
 * and return `null` instead of throwing when no row matches — Prisma raises P2025 when the
 * id+version filter selects nothing, i.e. a stale version or a missing row.
 *
 * This collapses the older `updateMany({ where: { id, version } })` + `findUnique` two-round-
 * trip into a single `UPDATE … RETURNING`, while preserving the "no match ⇒ null (conflict)"
 * contract the callers rely on.
 */
export async function updateOrNull<T>(op: () => Promise<T>): Promise<T | null> {
  try {
    return await op();
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2025') return null;
    throw e;
  }
}
