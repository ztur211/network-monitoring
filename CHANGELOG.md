# Changelog

All notable changes to NodeScope are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Cutting a release:** push a `vX.Y.Z` tag. That runs
[`.github/workflows/release.yml`](.github/workflows/release.yml), which builds the
cross-platform `nodescope-agent` binaries and the desktop installer, creates a
GitHub Release with auto-generated notes (PR titles since the last tag), and
publishes the agent binaries to DigitalOcean Spaces. Move the items below from
`[Unreleased]` into a new dated version section as part of the release PR.

## [Unreleased]

### Fixed

- **apps/web — F2 type debt cleared.** Removed the stale `BROWSER_CLIENT`
  `DeviceCategory` map entries and `DeviceDto.browserDeviceId` references left
  behind when browser-as-device was retired in F2 Phase B (commit `aa8b934`);
  completed the optimistic `DeviceDto` with the fields that retirement added
  (`networkId` / `propertyId` / `roleCode` / `x` / `y` / `z`); and pointed the Jest
  `react` module mapper at the resolved package so the store/lib suites run under a
  hoisted install. apps/web is now green (strict `tsc` + all 14 Jest suites, 182 tests).
- **apps/desktop — BCF `tsc -b` errors fixed.** The realtime topic/comment handlers
  in `use-bcf.ts` now take `(payload: unknown)` and narrow internally, matching the
  realtime client's `.on`/`.off` signature (as `use-device-load.ts` already did);
  and `CapturedViewpoint`'s camera vectors are typed as `[number, number, number]`
  tuples to satisfy `BcfCameraDto`. Desktop is green (`tsc -b` + 141 tests).

### Added

- **Release pipeline** (`.github/workflows/release.yml`): tag-driven build of the
  `nodescope-agent` Node-SEA single executables for Linux, macOS, and Windows; the
  desktop Windows installer; a GitHub Release with auto-generated notes; and an
  agent-binary publish to the DigitalOcean Spaces bucket the
  `apps/agent/scripts/install-*` scripts download from.
- **`deploy/real-env-verification.md`**: a concrete manual end-to-end verification
  checklist for the flows that cannot run in the build sandbox — agent
  enroll → poll → status, BCF round-trip with Solibri / BIMcollab, and launching the
  Electron desktop + Expo web GUIs.

### Changed

- `desktop-build.yml` is now `workflow_dispatch`-only; tag releases build and attach
  the desktop installer via `release.yml` (avoids a double build on `v*` tags).

---

## [0.1.0] — Roadmap complete (not yet tagged)

The full NodeScope roadmap (F1a / F1b / F2 / F3 + Spec 1–9) is merged to `master`.
This is the first release-candidate state. Headline capabilities:

- **3D BIM/GIS platform** — IFC model ingest + Three.js viewport, model-local device
  placement, floor handling, and an interactive map (MapLibre) of documented devices.
- **Monitoring** — a cross-platform reachability **agent** (enroll → sync → poll →
  push → heartbeat, with an offline buffer) plus an **SNMP** collector; server-side
  device status + bucketed metric series and live updates over WebSocket.
- **Interoperability** — **BCF** topic/comment authoring with import/export
  (`.bcfzip`) for round-tripping with Solibri / BIMcollab, and **IFC** export.
- **Collaboration** — team sites, role-scoped permissions (F3), and an AI onboarding
  wizard.

Detailed per-PR notes are produced automatically on the GitHub Release when this is
tagged `v0.1.0`.
