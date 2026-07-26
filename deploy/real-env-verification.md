# Real-environment release verification

Use this checklist on a desktop host before a release. Automated tests cover the
API contract, domain behavior, and headless client behavior. This pass covers the
real window system, browser callback, GPU path, local network probing, and external
BCF interoperability.

## 1. Start from release-shaped artifacts

- [ ] Build or pull the API, web, and tiles images for the candidate version.
- [ ] Stage signed agent payloads with `scripts/agent-release/build.sh`.
- [ ] Start a clean appliance with the same Compose files used in production.
- [ ] Run `./deploy/nodescope.sh smoke`.
- [ ] Confirm `http://<origin>/api/health` succeeds through Caddy.
- [ ] Confirm the local map style and one raster tile load with WAN disabled.

For a local candidate:

```bash
./scripts/run-desktop.sh --reset --backend-only
./deploy/nodescope.sh smoke --origin http://localhost:8080 --no-tiles
```

Build the map extract separately when validating the complete offline map path.

## 2. Native desktop and browser authentication

Run the packaged desktop artifact for the host OS, not `dotnet run`.

- [ ] The app opens without a console or startup error.
- [ ] The sign-in view accepts the appliance origin without `/api`.
- [ ] Sign-in opens the system browser at the same appliance origin.
- [ ] The `nodescope://auth/callback` activation focuses the existing app instance.
- [ ] A second app launch focuses the first instance instead of opening another.
- [ ] The session restores after closing and reopening the app.
- [ ] Signing out revokes and removes the stored token.
- [ ] Theme choice and appliance URL persist without storing secrets in settings.

## 3. Inventory and map

- [ ] Equipment, circuits, clients, and settings load without placeholder data.
- [ ] Create, edit, and delete a device.
- [ ] Create and edit a circuit.
- [ ] The map starts at the saved user location.
- [ ] Changing floors refreshes the viewport data immediately.
- [ ] Device markers, fiber runs, selection, and layer toggles remain synchronized.
- [ ] Disconnect the appliance, make an allowed offline edit, reconnect, and confirm
      the queued mutation drains once.

## 4. BIM and BCF

- [ ] Import a real IFC as an organization owner or admin.
- [ ] Progress stays responsive during conversion and upload.
- [ ] Geometry renders with correct camera fit and visible materials.
- [ ] Element picking opens stable IFC identity and property data.
- [ ] Place, move, link, and unlink a network device in model space.
- [ ] Create a BCF issue from the current view.
- [ ] Restoring the BCF viewpoint restores camera, visibility, and selection.
- [ ] Export the `.bcfzip` and open it in Solibri or BIMcollab.
- [ ] Modify the issue externally, import it, and confirm GUID-based update rather
      than duplication.

## 5. Realtime and monitoring

- [ ] Open two clients and confirm inventory and BCF changes arrive through SignalR.
- [ ] Stream an assistant response and confirm cancel, retry, and usage state.
- [ ] Generate a one-time agent enrollment code.
- [ ] Install the signed agent on a clean Linux x64, Linux arm64, or Windows x64 host.
- [ ] The installer rejects a modified binary, signature, and checksum.
- [ ] The agent enrolls, appears in Settings, and receives assigned devices.
- [ ] Reachable and unreachable targets update status and latency.
- [ ] Stop the appliance for at least one probe interval, then restore it and confirm
      the durable queue drains.
- [ ] Revoke the agent and confirm the next authenticated request fails.

## 6. Upgrade

- [ ] Install the previous released agent version.
- [ ] Point it at an appliance serving the candidate manifest.
- [ ] Confirm it downloads only the matching platform binary.
- [ ] Confirm signature and checksum verification happen before replacement.
- [ ] Confirm the service restarts the candidate version.
- [ ] Confirm the previous executable remains as `.old` for rollback.
- [ ] Confirm an older or equal manifest version is ignored.

## 7. Release artifacts

- [ ] `nodescope-agent-linux-x64`
- [ ] `nodescope-agent-linux-arm64`
- [ ] `nodescope-agent-win-x64.exe`
- [ ] A `.sha256` and `.sig` for each agent binary
- [ ] `manifest.json` with all three runtime identifiers
- [ ] Linux and Windows installers plus the systemd unit
- [ ] `nodescope-desktop-linux-x64.tar.gz`
- [ ] `nodescope-desktop-win-x64.zip`
- [ ] Versioned and `latest` API, web, and tiles images in GHCR
- [ ] The published web image serves the exact signed payload from the release
- [ ] The database backup script produces a restorable dump

Record the OS versions, GPU, appliance version, agent version, and any deviations
with the release sign-off.
