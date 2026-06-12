# NodeScope — Design & Implementation Corpus

This directory is the **forward-design corpus** for NodeScope's pivot from a per-user 2D GIS network-mapper into a **multi-tenant, enterprise, desktop-first 3D BIM/GIS + network-monitoring platform**.

Every feature went through the same discipline: **brainstorm → design spec → self-review → TDD phase plans → cross-plan review**. Each phase plan is test-first, ends green, and finishes with a phase gate. Specs decompose where scope grew (Spec 4 split out Monitoring; Monitoring split out the Agent; the Agent split into Core + SNMP; BCF deferred the BCF-API).

> **Status: 13 features fully designed + planned, 0 built.** All forward-design — execution happens in a dev env (this corpus was authored in a sandbox without Docker/Postgres/etc.). Branch: `share/local-docs`.

---

## Start here

| Doc | What it gives you |
|---|---|
| **[`BUILD-ORDER.md`](./BUILD-ORDER.md)** | The dependency-correct build order across all 13 features + env prerequisites + integration seams + how to execute the plans. **Read this first to build.** |
| **[`API-REFERENCE.md`](./API-REFERENCE.md)** | Every REST endpoint, error code, and WebSocket event across the corpus (the consolidated "API Design Document"). |
| **[`DATA-MODEL.md`](./DATA-MODEL.md)** | Every Prisma model + Timescale hypertable + enum, the `ChangeLog` entity list, and cross-cutting schema facts. |

`specs/` holds the design docs; `plans/` holds the TDD phase plans (46 files).

---

## The roadmap (by track)

Two tracks run in parallel and converge at **Spec 4**; monitoring follows it; interop is largely independent. (★ = the convergence point.)

### Tenancy & permissions
| Feature | Spec | Plans |
|---|---|---|
| **F1a** org tenancy/audit/enforcement | `specs/2026-06-06-f1a-org-tenancy-design.md` | `plans/2026-06-06-f1a-phase-{a,b,c,d}-*.md` (4) |
| **F1b** invitations & requests | `specs/2026-06-06-f1b-membership-growth-design.md` | `plans/2026-06-06-f1b-membership-growth.md` (1) |
| **F2** sites & node grouping | `specs/2026-06-08-f2-sites-node-grouping-design.md` | `plans/2026-06-08-f2-phase-{a,b,c,d}-*.md` (4) |
| **F3** team × site permissions | `specs/2026-06-09-f3-team-site-verb-permissions-design.md` | `plans/2026-06-09-f3-phase-{a,b,c,d}-*.md` (4) |

### 3D / spatial
| Feature | Spec | Plans |
|---|---|---|
| **Spec 1** spatial foundation | `specs/2026-06-09-spec1-spatial-foundation-design.md` | `plans/2026-06-09-spec1-phase-{a,b,c}-*.md` (3) |
| **Spec 2** desktop shell | `specs/2026-06-09-spec2-desktop-shell-design.md` | `plans/2026-06-09-spec2-phase-{a,b,c}-*.md` (3) |
| **Spec 3** 3D viewport | `specs/2026-06-11-spec3-3d-viewport-design.md` | `plans/2026-06-11-spec3-phase-{a,b,c,d}-*.md` (4) |
| **★ Spec 4** nodes in 3D | `specs/2026-06-11-spec4-nodes-in-3d-design.md` | `plans/2026-06-11-spec4-phase-{a,b,c,d}-*.md` (4) |

### Monitoring & agent
| Feature | Spec | Plans |
|---|---|---|
| **Spec 7** monitoring server + prober | `specs/2026-06-11-spec7-device-monitoring-design.md` | `plans/2026-06-11-spec7-phase-{a,b,c,d}-*.md` (4) |
| **Spec 8** agent core | `specs/2026-06-11-spec8-agent-core-design.md` | `plans/2026-06-11-spec8-phase-{a,b,c,d}-*.md` (4) |
| **Spec 9** agent SNMP | `specs/2026-06-12-spec9-agent-snmp-design.md` | `plans/2026-06-12-spec9-phase-{a,b,c,d}-*.md` (4) |

### Interop
| Feature | Spec | Plans |
|---|---|---|
| **Spec 5** IFC export | `specs/2026-06-12-spec5-ifc-export-design.md` | `plans/2026-06-12-spec5-phase-{a,b}-*.md` (2) |
| **Spec 6** BCF round-trip | `specs/2026-06-12-spec6-bcf-design.md` | `plans/2026-06-12-spec6-phase-{a,b,c,d,e}-*.md` (5) |

*(`2026-06-09-f3-brainstorm-progress.md` is a kept brainstorm note. The deferred **Spec 6/BCF** was later un-deferred and designed; **BCF-API/3.0**, IFC4 export, generic SNMP table mapping, and agent auto-update remain possible future specs.)*

## How to execute

Per the writing-plans handoff: build features in `BUILD-ORDER.md` order; within a feature, run its phases A→… in order; per phase plan, run its bite-sized TDD tasks (failing test → implement → pass → commit) and honor the phase gate + the per-spec cross-plan review. Drive it **subagent-driven** (a fresh subagent per task, review between) or **inline** (`executing-plans`, batch with checkpoints).
