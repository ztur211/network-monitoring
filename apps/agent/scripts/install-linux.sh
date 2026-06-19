#!/usr/bin/env bash
# NodeScope Agent - Linux installer
# Usage: sudo ./install-linux.sh --url <api-url> --code <enroll-code>
# Requirements: systemd, curl, root privileges

set -euo pipefail

BINARY_URL=""
ENROLL_URL=""
ENROLL_CODE=""
INSTALL_PATH="/usr/local/bin/nodescope-agent"
SERVICE_NAME="nodescope-agent"

usage() {
  echo "Usage: sudo $0 --url <api-url> --code <enroll-code> [--binary-url <binary-download-url>]"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) ENROLL_URL="$2"; shift 2 ;;
    --code) ENROLL_CODE="$2"; shift 2 ;;
    --binary-url) BINARY_URL="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; usage ;;
  esac
done

[[ -z "$ENROLL_URL" ]] && { echo "Error: --url is required"; usage; }
[[ -z "$ENROLL_CODE" ]] && { echo "Error: --code is required"; usage; }
[[ $EUID -ne 0 ]] && { echo "Error: must run as root (use sudo)"; exit 1; }

echo "[1/4] Installing nodescope-agent binary..."
if [[ -n "$BINARY_URL" ]]; then
  curl -fsSL "$BINARY_URL" -o "$INSTALL_PATH"
else
  # Assume binary is in the same directory as this script
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cp "$SCRIPT_DIR/../dist/nodescope-agent" "$INSTALL_PATH"
fi
chmod +x "$INSTALL_PATH"

echo "[2/4] Enrolling agent..."
"$INSTALL_PATH" enroll --code "$ENROLL_CODE" --url "$ENROLL_URL"

echo "[3/4] Installing systemd service..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/nodescope-agent.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo "[4/4] Starting service..."
systemctl start "$SERVICE_NAME"
systemctl status "$SERVICE_NAME" --no-pager

echo "nodescope-agent installed and running. Check logs: journalctl -u $SERVICE_NAME -f"
