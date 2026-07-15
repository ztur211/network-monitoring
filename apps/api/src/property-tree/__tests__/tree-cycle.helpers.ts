import { HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';
import { PROPERTY_TREE_CYCLE } from '../property-tree.repository';

/**
 * Test helpers for the Property-hierarchy cycle guard, shared by every spec that exercises a tree
 * walk (property-tree, permissions, properties, spatial).
 *
 * A cyclic tree makes an unguarded recursive CTE spin forever inside Postgres, so these tests cannot
 * simply await the query: against unguarded code they would hang until jest's timeout, which is a
 * slow and confusing failure. `settlesWithin` turns "never terminates" into an explicit, fast,
 * readable assertion failure instead.
 */

/** Generous enough that a correct (cycle-detecting) walk always beats it; short enough to fail fast. */
export const CYCLE_TIMEOUT_MS = 8_000;

/** Rejects with a descriptive error if `work` has not settled within `ms`. */
export async function settlesWithin<T>(work: Promise<T>, ms: number): Promise<T> {
  // An unguarded walk stays pending until the connection drops, and would then reject into the void.
  work.catch(() => undefined);

  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Tree walk did not terminate within ${ms}ms: the traversal is unbounded on a cyclic tree ` +
              'and is spinning inside Postgres, holding its connection.',
          ),
        ),
      ms,
    );
  });

  try {
    return await Promise.race([work, guard]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asserts the walk terminates AND refuses the corrupt tree with PROPERTY_TREE_CYCLE, rather than
 * hanging (old behavior) or silently returning a wrong id set (what UNION / a depth cap would do).
 */
export async function expectPropertyTreeCycle(run: () => Promise<unknown>): Promise<void> {
  type Outcome = { threw: false; value: unknown } | { threw: true; error: unknown };
  const outcome: Outcome = await settlesWithin(run(), CYCLE_TIMEOUT_MS).then(
    (value): Outcome => ({ threw: false, value }),
    (error: unknown): Outcome => ({ threw: true, error }),
  );

  if (outcome.threw === false) {
    throw new Error(
      `Expected PROPERTY_TREE_CYCLE, but the walk returned ${JSON.stringify(outcome.value)}. ` +
        'Terminating is not enough - a cyclic tree must never yield a scope silently.',
    );
  }
  // Surface the "did not terminate" guard (and any other unexpected error) as-is.
  if (!(outcome.error instanceof NodeScopeException)) throw outcome.error;

  expect(outcome.error.code).toBe(PROPERTY_TREE_CYCLE);
  expect(outcome.error.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
}

/**
 * Persists a parent/child cycle by pointing `childId`'s parent at `descendantId` (a node beneath it).
 * Raw SQL on purpose: this is exactly the corruption a bad restore, a manual fix or a future bulk
 * import can leave behind, and which no application-level check can retro-actively prevent.
 */
export async function createCycle(
  prisma: PrismaService,
  ancestorId: string,
  descendantId: string,
): Promise<void> {
  await prisma.$executeRaw`UPDATE "Property" SET "parentId" = ${descendantId} WHERE "id" = ${ancestorId}`;
}

/**
 * Breaks every parent link in the org so the rows can actually be deleted: Property.parentId is
 * ON DELETE RESTRICT, so a cyclic set cannot be removed while the cycle stands. Call before deleting
 * the org, or the cycle leaks into the shared test database.
 */
export async function breakCycles(prisma: PrismaService, organizationId: string): Promise<void> {
  await prisma.$executeRaw`UPDATE "Property" SET "parentId" = NULL WHERE "organizationId" = ${organizationId}`;
}
