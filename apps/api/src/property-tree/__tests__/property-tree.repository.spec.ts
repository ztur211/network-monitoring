import { Test, TestingModule } from '@nestjs/testing';
import { Property } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PropertyTreeRepository } from '../property-tree.repository';
import {
  CYCLE_TIMEOUT_MS,
  breakCycles,
  createCycle,
  expectPropertyTreeCycle,
  settlesWithin,
} from './tree-cycle.helpers';

describe('PropertyTreeRepository (integration)', () => {
  let repo: PropertyTreeRepository;
  let prisma: PrismaService;
  let orgId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [PropertyTreeRepository, PrismaService],
    }).compile();
    repo = moduleRef.get(PropertyTreeRepository);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: { name: `TR${Date.now()}${Math.round(performance.now())}` },
    });
    orgId = org.id;
  });
  afterEach(async () => {
    // Must break the cycle first: parentId is ON DELETE RESTRICT, so a cyclic set is undeletable.
    await breakCycles(prisma, orgId);
    await prisma.organization.delete({ where: { id: orgId } });
  });

  function makeProperty(
    name: string,
    type: Property['type'],
    parentId: string | null,
    code: string | null = null,
  ) {
    return prisma.property.create({ data: { organizationId: orgId, parentId, type, name, code } });
  }

  /** SITE(HQ) -> BUILDING(B1) -> FLOOR(F1), plus a sibling BUILDING(B2) under the same site. */
  async function makeTree() {
    const hq = await makeProperty('HQ', 'SITE', null, 'hq');
    const b1 = await makeProperty('B1', 'BUILDING', hq.id, 'b1');
    const f1 = await makeProperty('F1', 'FLOOR', b1.id, 'f1');
    const b2 = await makeProperty('B2', 'BUILDING', hq.id, 'b2');
    return { hq, b1, f1, b2 };
  }

  describe('on a well-formed tree', () => {
    it('walks up from self to the root, carrying type + code', async () => {
      const { hq, b1, f1 } = await makeTree();

      expect(await repo.ancestorChain(orgId, f1.id)).toEqual([
        { id: f1.id, type: 'FLOOR', code: 'f1' },
        { id: b1.id, type: 'BUILDING', code: 'b1' },
        { id: hq.id, type: 'SITE', code: 'hq' },
      ]);
      expect(await repo.ancestorIds(orgId, f1.id)).toEqual([f1.id, b1.id, hq.id]);
      expect(await repo.ancestorIds(orgId, hq.id)).toEqual([hq.id]);
    });

    it('walks down to self + every descendant', async () => {
      const { hq, b1, f1, b2 } = await makeTree();

      expect((await repo.subtreeIds(orgId, hq.id)).sort()).toEqual([hq.id, b1.id, f1.id, b2.id].sort());
      expect((await repo.subtreeIds(orgId, b1.id)).sort()).toEqual([b1.id, f1.id].sort());
      expect(await repo.subtreeIds(orgId, f1.id)).toEqual([f1.id]);
    });

    it('answers isAtOrUnder for self, descendants and unrelated nodes', async () => {
      const { hq, f1, b2 } = await makeTree();

      expect(await repo.isAtOrUnder(orgId, f1.id, hq.id)).toBe(true); // grandchild
      expect(await repo.isAtOrUnder(orgId, hq.id, hq.id)).toBe(true); // self
      expect(await repo.isAtOrUnder(orgId, hq.id, f1.id)).toBe(false); // inverted
      expect(await repo.isAtOrUnder(orgId, f1.id, b2.id)).toBe(false); // sibling branch
    });

    it('never crosses an organization boundary', async () => {
      const { f1 } = await makeTree();
      const other = await prisma.organization.create({ data: { name: `TRX${Date.now()}` } });

      expect(await repo.ancestorIds(other.id, f1.id)).toEqual([]);
      expect(await repo.subtreeIds(other.id, f1.id)).toEqual([]);

      await prisma.organization.delete({ where: { id: other.id } });
    });

    /**
     * Guards the fix itself. ALLOWED_CHILDREN permits SITE > SITE and AREA > AREA, so a valid tree
     * has NO bounded depth - which is precisely why a `WHERE depth < N` cap is not an acceptable way
     * to make these walks terminate. A cap would silently truncate this chain and, on the
     * authorization path, silently under-scope a member. If someone ever "simplifies" the CYCLE
     * clause into a depth cap, this test fails.
     */
    it('does not truncate a legitimately deep chain (no depth cap)', async () => {
      const DEPTH = 200;
      let current = await makeProperty('Deep site', 'SITE', null);
      const expected = [current.id];
      for (let i = 0; i < DEPTH; i++) {
        current = await makeProperty(`Area ${i}`, 'AREA', current.id);
        expected.push(current.id);
      }

      // Upward from the deepest leaf: self -> root, every level present, in order.
      expect(await repo.ancestorIds(orgId, current.id)).toEqual([...expected].reverse());
      // Downward from the root: every level present.
      expect((await repo.subtreeIds(orgId, expected[0])).sort()).toEqual([...expected].sort());
      expect(await repo.isAtOrUnder(orgId, current.id, expected[0])).toBe(true);
    });
  });

  describe('on a tree corrupted with a cycle', () => {
    // The corruption an app-level reparent check can never catch, because that check is itself a
    // tree walk: HQ's parent is set to the FLOOR beneath it.  HQ -> B1 -> F1 -> HQ ...
    async function makeCyclicTree() {
      const tree = await makeTree();
      await createCycle(prisma, tree.hq.id, tree.f1.id);
      return tree;
    }

    it('terminates and raises PROPERTY_TREE_CYCLE walking up', async () => {
      const { f1 } = await makeCyclicTree();
      await expectPropertyTreeCycle(() => repo.ancestorChain(orgId, f1.id));
      await expectPropertyTreeCycle(() => repo.ancestorIds(orgId, f1.id));
    });

    it('terminates and raises PROPERTY_TREE_CYCLE walking down (the authorization path)', async () => {
      const { f1 } = await makeCyclicTree();
      await expectPropertyTreeCycle(() => repo.subtreeIds(orgId, f1.id));
    });

    it('terminates and raises PROPERTY_TREE_CYCLE from isAtOrUnder (the reparent guard)', async () => {
      const { hq, b2 } = await makeCyclicTree();
      await expectPropertyTreeCycle(() => repo.isAtOrUnder(orgId, b2.id, hq.id));
    });

    /**
     * The whole reason we refuse instead of deduping with UNION. Through the bad edge, F1's
     * "subtree" reaches its own ancestor HQ and the sibling building B2 - so a member assigned only
     * to F1 would be silently scoped over the entire site. Any answer here is an answer that grants
     * too much, so there must be no answer.
     */
    it('refuses rather than widening a member scope through the cycle', async () => {
      const { f1 } = await makeCyclicTree();

      const outcome = await settlesWithin(repo.subtreeIds(orgId, f1.id), CYCLE_TIMEOUT_MS).then(
        (ids) => ({ ids }),
        () => null,
      );
      expect(outcome).toBeNull(); // no id set at all - not a wider one
    });

    it('contains the blast radius: a cycle in one org does not break another', async () => {
      await makeCyclicTree();

      const other = await prisma.organization.create({ data: { name: `TRC${Date.now()}` } });
      const site = await prisma.property.create({
        data: { organizationId: other.id, parentId: null, type: 'SITE', name: 'Clean' },
      });

      await expect(settlesWithin(repo.subtreeIds(other.id, site.id), CYCLE_TIMEOUT_MS)).resolves.toEqual([
        site.id,
      ]);

      await prisma.organization.delete({ where: { id: other.id } });
    });
  });
});
