#!/usr/bin/env bash
# NodeScope Agent - Linux installer, served by the appliance at /agent/install.sh.
#
# Usage (shown by the web UI's enrollment dialog):
#   curl -fsSL http://<server>/agent/install.sh | sudo bash -s -- --server http://<server> --code <enroll-code>
#
# Downloads the agent binary from the same appliance, verifies its sha256 and
# its publisher signature against the pinned key below, installs it, enrolls
# (unless already enrolled), and starts the systemd service. Re-running without
# --code upgrades the binary in place and keeps the existing enrollment.
# Requirements: systemd, curl, openssl, root privileges.
set -euo pipefail

SERVER=""
ENROLL_CODE=""
INSTALL_PATH="/usr/local/bin/nodescope-agent"
SERVICE_NAME="nodescope-agent"
CREDENTIALS_PATH="/etc/nodescope-agent/credentials.json"

# The NodeScope agent publisher key. Must match the key pinned inside the agent
# binary (SelfUpdate.cs); a binary failing this check must never be installed.
PUBLIC_KEY="-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAERu82LnwHi9fVXevrloVhU73HeZcG
O8vPFg8UsNyWcytI10CtnPz/KvlUPRsRdPU+4U5PMgnguurkmBI9Xkwlag==
-----END PUBLIC KEY-----"

usage() {
  echo "Usage: curl -fsSL http://<server>/agent/install.sh | sudo bash -s -- --server http://<server> [--code <enroll-code>]"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server) SERVER="${2%/}"; shift 2 ;;
    --code) ENROLL_CODE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; usage ;;
  esac
done

[[ -z "$SERVER" ]] && { echo "Error: --server is required"; usage; }
[[ $EUID -ne 0 ]] && { echo "Error: must run as root (use sudo)"; exit 1; }

case "$(uname -m)" in
  x86_64) FILE="nodescope-agent-linux-x64" ;;
  aarch64) FILE="nodescope-agent-linux-arm64" ;;
  *) echo "Error: unsupported architecture $(uname -m)"; exit 1 ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[1/5] Downloading $FILE from $SERVER/agent/ ..."
curl -fsSL "$SERVER/agent/$FILE" -o "$TMP/$FILE"
curl -fsSL "$SERVER/agent/$FILE.sha256" -o "$TMP/$FILE.sha256"
curl -fsSL "$SERVER/agent/$FILE.sig" -o "$TMP/$FILE.sig"

echo "[2/5] Verifying checksum and publisher signature..."
(cd "$TMP" && sha256sum -c "$FILE.sha256" > /dev/null)
echo "$PUBLIC_KEY" > "$TMP/publisher.pub"
openssl dgst -sha256 -verify "$TMP/publisher.pub" -signature "$TMP/$FILE.sig" "$TMP/$FILE" > /dev/null
echo "  OK: binary is authentic"

echo "[3/5] Installing $INSTALL_PATH ..."
install -m 0755 "$TMP/$FILE" "$INSTALL_PATH"

if [[ -n "$ENROLL_CODE" ]]; then
  echo "[4/5] Enrolling agent..."
  "$INSTALL_PATH" enroll --code "$ENROLL_CODE" --url "$SERVER/api"
elif [[ -f "$CREDENTIALS_PATH" ]]; then
  echo "[4/5] Already enrolled ($CREDENTIALS_PATH exists) - keeping credentials."
else
  echo "Error: not enrolled and no --code given. Generate an enrollment code in the web UI." >&2
  exit 1
fi

echo "[5/5] Installing and starting the systemd service..."
curl -fsSL "$SERVER/agent/nodescope-agent.service" -o /etc/systemd/system/nodescope-agent.service
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
systemctl status "$SERVICE_NAME" --no-pager

echo "nodescope-agent installed and running. Check logs: journalctl -u $SERVICE_NAME -f"
