# F3 — Brainstorm Progress (COMPLETE — superseded by the finished spec)

**Status:** Brainstorming finished 2026-06-09. The design is now the spec at
[`specs/2026-06-09-f3-team-site-verb-permissions-design.md`](specs/2026-06-09-f3-team-site-verb-permissions-design.md).
This working note is kept only for history; the spec is authoritative.

## How the open questions resolved

The earlier "team × site × **verb**" framing simplified during design — the verb axis **collapsed into the role**. Final model:

- **Two axes:** **role = verb ceiling** (`MEMBER` view / `ADMIN` configure / `OWNER` everything + billing + delete + user/role management); **assignment = which site subtrees** (the "where"). Effective access = role ceiling applied within assigned subtrees; outside them, invisible.
- **ADMIN** is **site-scoped** — configures only the sites assigned to it (a "regional admin"); an org-wide admin is just one assigned the root. The OWNER is unscoped and the org-level authority.
- **Assignment via teams** (reusable) **+ direct per-member grants** (one-off, fine-grained).
- **Delegation:** OWNER manages anyone/any role/any site; ADMIN invites & configures **members only** and may grant them **any subset of the admin's own** sites — never beyond (no escalation).
- **Verb is binary** (view vs configure), **grants are uniform per site** (no per-object-type), **shared networks** show each caller only the in-scope parts.

Resolved/superseded items 1–7 from the prior note are all folded into the spec (§1–§8); per-object-type and per-action granularity became explicit **non-goals** (spec §3).
