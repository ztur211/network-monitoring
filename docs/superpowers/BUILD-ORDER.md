# NodeScope — Build Handoff & Execution Order

This is the execution guide for the forward-designed roadmap. Every feature has a design **spec** (`docs/superpowers/specs/`) and a set of TDD **phase plans** (`docs/superpowers/plans/`), all on branch `share/local-docs`. Nothing is built yet — this document is the dependency-correct order to build them in, with the environment and integration notes each needs.

**Convention:** each phase plan is TDD (test-first), ends green, and finishes with a phase gate. Execute one feature at a time, in order; within a feature, execute its phases A→… in order. Use **subagent-driven** execution (a fresh subagent per task, review between) or **inline** (`executing-plans`, batch with checkpoints).

---

## Environment prerequisites (dev env — not the design sandbox)

- **Docker Compose:** PostgreSQL = **TimescaleDB** (`timescaledb-ha:pg16`), **Redis** (realtime), **MinIO** (S3-compatible object storage). A `docker-compose.test.yml` mirrors these on alt ports for integration/e2e (DB `:5433`, MinIO `:9100`).
- **Node** (api = NestJS 11 / Prisma 5; web = Expo/RN-Web; desktop = Electron/electron-vite; agent = Node→single binary).
- **Env:** `DATABASE_URL`, `REDIS_URL`, `STORAGE_*` (MinIO), Better Auth secrets, `SECRET_ENCRYPTION_KEY` (Spec 9), `MONITORING_*` (Spec 7 prober, off by default), `BCF_MAX_BYTES` (Spec 6).
- **Per-track libs (installed by the relevant phase):** `@aws-sdk/client-s3` (Spec 1); `react-three-fiber`/`@react-three/drei`/`web-ifc`/`three` (Spec 3); `@nestjs/schedule` or a guarded interval (Spec 7); Node SEA/`pkg` (Spec 8 binary); `net-snmp` (Spec 9); `jszip`/`fast-xml-parser` (Spec 6).

---

## Build order

Two tracks run in parallel and **converge at Spec 4**; monitoring (7→8→9) follows Spec 4; interop (5, 6) is largely independent. A safe **linear** order:

| # | Feature | Phase plans | Depends on | Key env/libs |
|---|---|---|---|---|
| 1 | **F1a** org tenancy/audit/enforcement | `2026-06-06-f1a-phase-{a,b,c,d}-*` (4) | the pre-pivot 2D app baseline (`master`) | Postgres, Redis, Better Auth |
| 2 | **F1b** invitations/requests | `2026-06-06-f1b-membership-growth` (1) | F1a | — |
| 3 | **F2** sites & node grouping | `2026-06-08-f2-phase-{a,b,c,d}-*` (4) | F1a | — |
| 4 | **F3** team × site permissions | `2026-06-09-f3-phase-{a,b,c,d}-*` (4) | F1a, F2 (+ F1b for invite-auth) | — |
| 5 | **Spec 1** spatial foundation | `2026-06-09-spec1-phase-{a,b,c}-*` (3) | F1a, F2 | **MinIO** (object storage) |
| 6 | **Spec 2** desktop shell | `2026-06-09-spec2-phase-{a,b,c}-*` (3) | F1a, F2, Spec 1 (PI) | Electron, electron-vite, `@nodescope/client` |
| 7 | **Spec 3** 3D viewport | `2026-06-11-spec3-phase-{a,b,c,d}-*` (4) | Spec 1, Spec 2 | `web-ifc`, `three`, r3f/drei |
| 8 | **Spec 4** nodes in 3D (convergence) | `2026-06-11-spec4-phase-{a,b,c,d}-*` (4) | Spec 1, Spec 3, **F3** | — |
| 9 | **Spec 5** IFC export | `2026-06-12-spec5-phase-{a,b}-*` (2) | Spec 1, F2/F3 | none (dependency-free STEP) |
| 10 | **Spec 7** monitoring server + prober | `2026-06-11-spec7-phase-{a,b,c,d}-*` (4) | F1a/F3, the device model, **Spec 4** status seam | TimescaleDB hypertables, scheduler, `NET_RAW` (ICMP) |
| 11 | **Spec 8** agent core | `2026-06-11-spec8-phase-{a,b,c,d}-*` (4) | Spec 7 (ingest) | `@nodescope/probe`, Node SEA/`pkg` |
| 12 | **Spec 9** agent SNMP | `2026-06-12-spec9-phase-{a,b,c,d}-*` (4) | Spec 8 | `net-snmp`, `SECRET_ENCRYPTION_KEY` |
| 13 | **Spec 6** BCF round-trip | `2026-06-12-spec6-phase-{a,b,c,d,e}-*` (5) | Spec 5 (`toIfcGuid`), Spec 1, Spec 3/4 (viewport) | `jszip`, `fast-xml-parser`, MinIO |

**Parallelism (if more than one builder):** the permissions track (1→2→3→4) and the 3D track (5→6→7) can proceed in parallel after F1a+F2 exist, meeting at **Spec 4** (step 8, which needs F3). **Spec 5** (step 9) only needs Spec 1, so it can be built any time after step 5. Monitoring (10→11→12) and BCF (13) come after Spec 4.

---

## Cross-cutting "flagged for execution" (from the plans' self-reviews)

Aggregated integration points to confirm as you build — each is localized and called out in the relevant phase plan:
- **Schema/migrations:** every feature that adds models extends F1a's `ChangeLog` entity-type CHECK (raw SQL appended to the Prisma migration) — reconcile the list each time. Greenfield: `prisma migrate reset --force`.
- **Permissions seam:** F3's `PermissionsService` (`inScope`/`scopeFilter`/`assertCanView`/`assertCanConfigure`) is the chokepoint every later read/write/realtime path threads through; F2's `PropertiesService` (`subtreePropertyIds`/`isAtOrUnder`) underlies it.
- **Realtime:** the F3-scoped device/topic/status event fan-out (the gateway's scoped emit) is reused by Spec 4 (`v1:device:*`), Spec 7 (`v1:device:status`), Spec 6 (`v1:bcf:*`).
- **Object storage:** Spec 1's `StorageService` (proxied, private MinIO bucket) is reused by Spec 6 snapshots.
- **Coordinate frame:** Spec 3's `ParsedModel.frame` (recenter + Z-up→Y-up) and Spec 4's `node-coords` (`toViewport`/`toModel`) are reused by Spec 6 viewpoint conversion. `toIfcGuid` (Spec 5) is extracted to `@nodescope/shared` and shared by Spec 6.
- **Shared seams between specs:** Spec 4's `setNodeStatus` (filled by Spec 7); Spec 7's ingest (fed by Spec 8/9); Spec 8's collector seam (extended by Spec 9 SNMP); Spec 5's `toIfcGuid` (used by Spec 6).
- **Native/external bits to verify against real deps:** `web-ifc` API (Spec 3/Spec 6 `guidIndex`); `net-snmp` API (Spec 9); the BCF `.bcfzip` against a real tool (Solibri/BIMcollab, Spec 6); IFC tool-import of the Spec 5 export; Node single-binary packaging (Spec 8); `NET_RAW`/`ping` for ICMP (Spec 7/8).

---

## How to execute a feature's plans

Per the writing-plans handoff, for each feature in order:
1. **Subagent-driven (recommended):** dispatch a fresh subagent per task in the phase plan; review between tasks; the two-stage review catches drift. Fast iteration, clean context per task.
2. **Inline (`executing-plans`):** batch-execute the tasks in one session with review checkpoints at phase gates.

Each phase plan's tasks are bite-sized TDD (failing test → run-fail → implement → run-pass → commit) with exact paths, complete code, and a phase-gate (full suite + docs + commit). Honor the per-phase **Self-Review Checklist** and the per-spec **cross-plan review** at the end of the multi-phase plans.

> Status: **0 of 13 built.** This corpus (13 specs + 46 phase plans) is the complete, reviewable design for a multi-tenant enterprise 3D BIM/GIS + network-monitoring platform, ready to build.
