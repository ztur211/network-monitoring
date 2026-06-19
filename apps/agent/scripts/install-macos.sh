#!/usr/bin/env bash
# NodeScope Agent - macOS installer
# Usage: sudo ./install-macos.sh --url <api-url> --code <enroll-code>
# Requirements: macOS 12+, launchd, root privileges

set -euo pipefail

BINARY_URL=""
ENROLL_URL=""
ENROLL_CODE=""
INSTALL_PATH="/usr/local/bin/nodescope-agent"
PLIST_LABEL="com.nodescope.agent"
PLIST_PATH="/Library/LaunchDaemons/${PLIST_LABEL}.plist"

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
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cp "$SCRIPT_DIR/../dist/nodescope-agent" "$INSTALL_PATH"
fi
chmod +x "$INSTALL_PATH"

echo "[2/4] Enrolling agent..."
"$INSTALL_PATH" enroll --code "$ENROLL_CODE" --url "$ENROLL_URL"

echo "[3/4] Installing launchd plist..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/nodescope-agent.plist" "$PLIST_PATH"
# Patch the plist with actual install path if needed
/usr/libexec/PlistBuddy -c "Set :ProgramArguments:0 $INSTALL_PATH" "$PLIST_PATH" 2>/dev/null || true
chown root:wheel "$PLIST_PATH"
chmod 644 "$PLIST_PATH"

echo "[4/4] Loading and starting service..."
launchctl bootout system "$PLIST_PATH" 2>/dev/null || true
launchctl bootstrap system "$PLIST_PATH"

echo "nodescope-agent installed and running. Check logs:"
echo "  stdout: /var/log/nodescope-agent.log"
echo "  stderr: /var/log/nodescope-agent.err"
echo "  status: launchctl list | grep nodescope"
