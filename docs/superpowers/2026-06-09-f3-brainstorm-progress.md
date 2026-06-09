# F3 — Brainstorm Progress (IN PROGRESS — not a finished spec)

**Status:** Paused mid-clarifying-questions on 2026-06-09. This is a working note, not a spec. The finished spec will land at `specs/2026-06-09-f3-team-site-verb-permissions-design.md`.

## What F3 is
The permissions layer: **NetBox-style team × site × verb** grants that replace F2's interim coarse posture (MEMBER read-only / OWNER+ADMIN mutate). Enforced at F1a's repository-scoping seam using F2's anchor — `governingSiteId(device) = device.propertyId` plus `PropertiesService.subtreePropertyIds` / `isAtOrUnder`. Grounded in NetBox object-permissions (group × object-type × actions × constraints), with the "constraint" specialized to a **site subtree**.

## Decided so far
- **Read + write scoping (true visibility):** a user sees and acts on only the sites their teams grant. `view` is a verb; every list/get **and** realtime feed filters to the user's granted site subtrees. (Chosen over "writes-only / everyone sees everything.")

## Open — resume here
1. **OrgRole ↔ grant interplay — what ADMIN means** (the next decision; user wanted to discuss before picking). OWNER = org-wide everything and MEMBER = data only via team grants are near-certain. The fork for ADMIN:
   - (a) **Site-scoped admin** — authority (data + grant/structure management) bounded to assigned site subtree(s).
   - (b) **Org-wide admin, data-scoped** — manages config org-wide; own data view/edit via grants (soft restriction: admins can self-grant).
   - (c) **Admin org-wide full** (≈ co-owner; contradicts "admins can be restricted to certain sites").
   Guiding note from the user: *"Owner and admins can have different levels of permissions, which may also be restricted to certain sites."*
2. Team membership model (a user in multiple teams → union of grants?).
3. Verb set granularity (view / edit / delete; split out create?).
4. Object-type scope of a grant (per entity type vs uniform per site).
5. Grant combination semantics (union / most-permissive).
6. Multi-site network authorization (a network spans sites — view/edit policy when its sites aren't all granted).
7. Realtime per-site filtering mechanism (per-site rooms vs filtered emit from the org room).
