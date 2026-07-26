# Real-environment release verification

Use this checklist on a desktop host before a release. Automated tests cover the
API contract, domain behavior, and headless client behavior. This pass covers the
real window system, GPU path, local network probing, and external
BCF interoperability.

## 1. Start from release-shaped artifacts

- [ ] Build or pull the API, gateway, and tiles images for the candidate version.
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

## 2. Native desktop authentication

Run the packaged desktop artifact for the host OS, not `dotnet run`.

- [ ] The app opens without a console or startup error.
- [ ] The sign-in view accepts the appliance origin without `/api`.
- [ ] Sign-in with email and password completes in the app; no browser opens.
- [ ] Create-account mode provisions a fresh authenticated account.
- [ ] An account without membership lands on the organization access screen.
- [ ] Wrong credentials surface "Invalid email or password" in the form.
- [ ] A second app launch focuses the first instance instead of opening another.
- [ ] The session restores after closing and reopening the app.
- [ ] Signing out revokes and removes the stored token.
- [ ] Theme choice and appliance URL persist without storing secrets in settings.

## 3. Organization access

Run the bootstrap checks against a clean database that contains zero
organizations.

- [ ] The installer prints a bootstrap code and stores it in mode-0600
      `deploy/.env`.
- [ ] The first account creates the first organization with that code and becomes
      OWNER.
- [ ] A wrong code returns the specific invalid-code message without changing
      database state.
- [ ] A second bootstrap attempt is rejected after the first organization exists.
- [ ] OWNER creates a MEMBER invitation and the native client displays the full
      copyable code once.
- [ ] A different email cannot redeem the invitation.
- [ ] The invited account redeems the code without signing in again.
- [ ] OWNER sees both people in the roster and can revoke a pending invitation.
- [ ] ADMIN can invite MEMBER but cannot issue an ADMIN or OWNER invitation.
- [ ] If a domain is configured, a matching user can request access and OWNER or
      ADMIN can approve or deny the request.
- [ ] Signing out from the organization access screen revokes the session.

## 4. Inventory and map

- [ ] Equipment, circuits, clients, and settings load without placeholder data.
- [ ] Create, edit, and delete a device.
- [ ] Create and edit a circuit.
- [ ] The map starts at the saved user location.
- [ ] Changing floors refreshes the viewport data immediately.
- [ ] Device markers, fiber runs, selection, and layer toggles remain synchronized.
- [ ] Disconnect the appliance and attempt an edit. The client must report failure
      without claiming the change was saved.
- [ ] Reconnect and confirm the client reloads current appliance state.

## 5. BIM and BCF

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

## 6. Realtime and monitoring

- [ ] Open two clients and confirm inventory and BCF changes arrive through SignalR.
- [ ] Send an assistant message and confirm the degraded response is marked
      provider unavailable with zero tokens charged.
- [ ] Generate a one-time agent enrollment code.
- [ ] Install the signed agent on a clean Linux x64, Linux arm64, or Windows x64 host.
- [ ] The installer rejects a modified binary, signature, and checksum.
- [ ] The agent enrolls, appears in Settings, and receives assigned devices.
- [ ] Reachable and unreachable targets update status and latency.
- [ ] Stop the appliance for at least one probe interval, then restore it and confirm
      the durable queue drains.
- [ ] Revoke the agent and confirm the next authenticated request fails.

## 7. Upgrade

- [ ] Install the previous released agent version.
- [ ] Point it at an appliance serving the candidate manifest.
- [ ] Confirm it downloads only the matching platform binary.
- [ ] Confirm signature and checksum verification happen before replacement.
- [ ] Confirm the service restarts the candidate version.
- [ ] Confirm the previous executable remains as `.old` for rollback.
- [ ] Confirm an older or equal manifest version is ignored.

## 8. Release artifacts

- [ ] `nodescope-agent-linux-x64`
- [ ] `nodescope-agent-linux-arm64`
- [ ] `nodescope-agent-win-x64.exe`
- [ ] A `.sha256` and `.sig` for each agent binary
- [ ] `manifest.json` with all three runtime identifiers
- [ ] Linux and Windows installers plus the systemd unit
- [ ] `nodescope-desktop-linux-x64.tar.gz`
- [ ] `nodescope-desktop-win-x64.zip`
- [ ] Versioned and `latest` API, gateway (`nodescope-web`), and tiles images in
      GHCR
- [ ] The published gateway image serves the exact signed payload from the release
- [ ] The database backup script produces a restorable dump

Record the OS versions, GPU, appliance version, agent version, and any deviations
with the release sign-off.
