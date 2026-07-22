#!/usr/bin/env bash
# Builds, signs, and stages the agent release payload (Decision 13).
#
# Publishes the NativeAOT agent for linux-x64 (and win-x64 when the Windows
# host's dotnet.exe is reachable via WSL interop - NativeAOT cannot
# cross-compile), signs each binary with the publisher key, and stages
# everything the appliance serves at /agent/* into deploy/agent-dist/:
#
#   nodescope-agent-<rid>[.exe]         the binaries
#   nodescope-agent-<rid>[.exe].sha256  "sha256sum -c" input
#   nodescope-agent-<rid>[.exe].sig     ECDSA P-256/SHA-256 signature (DER)
#   manifest.json                       version + per-platform sha256/signature
#   install.sh / install.ps1            the installers (from deploy/agent/)
#   nodescope-agent.service             systemd unit, fetched by install.sh
#
# Dockerfile.web copies deploy/agent-dist/ into the image at /srv/agent, which
# Caddy serves at /agent/*. Usage:
#   scripts/agent-release/build.sh [--version X.Y.Z]
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

DOTNET="${DOTNET:-$HOME/.dotnet/dotnet}"
KEY_PATH="${NODESCOPE_AGENT_SIGNING_KEY:-$HOME/.nodescope/agent-signing.key}"
DIST="deploy/agent-dist"
PROJECT="src/NodeScope.Agent"

VERSION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done
if [[ -z "$VERSION" ]]; then
  VERSION="$(sed -n 's/.*<Version>\(.*\)<\/Version>.*/\1/p' "$PROJECT/NodeScope.Agent.csproj")"
fi
[[ -n "$VERSION" ]] || { echo "Could not determine a version" >&2; exit 1; }

[[ -f "$KEY_PATH" ]] || {
  echo "Signing key missing: $KEY_PATH (run scripts/agent-release/keygen.sh once)" >&2
  exit 1
}

# The key that signs must be the key the agent pins, or every produced update
# would be refused in the field. Compare against the PEM embedded in SelfUpdate.cs.
PINNED="$(sed -n '/-----BEGIN PUBLIC KEY-----/,/-----END PUBLIC KEY-----/p' "$PROJECT/SelfUpdate.cs" | sed 's/^ *//')"
ACTUAL="$(openssl ec -in "$KEY_PATH" -pubout 2>/dev/null)"
if [[ "$PINNED" != "$ACTUAL" ]]; then
  echo "Signing key does not match the public key pinned in SelfUpdate.cs - refusing to build" >&2
  exit 1
fi

rm -rf "$DIST"
mkdir -p "$DIST"
# Keep the placeholder so Dockerfile.web's COPY works from a clean checkout too.
touch "$DIST/.gitkeep"

stage() { # stage <publish-dir-binary> <staged-name>
  cp "$1" "$DIST/$2"
  chmod 755 "$DIST/$2"
  openssl dgst -sha256 -sign "$KEY_PATH" -out "$DIST/$2.sig" "$DIST/$2"
  (cd "$DIST" && sha256sum "$2" > "$2.sha256")
  # Prove the artifact verifies with the pinned key before it can ship.
  openssl dgst -sha256 -verify <(echo "$ACTUAL") -signature "$DIST/$2.sig" "$DIST/$2" > /dev/null
}

manifest_entry() { # manifest_entry <rid> <staged-name>
  local sha sig
  sha="$(cut -d' ' -f1 "$DIST/$2.sha256")"
  sig="$(base64 -w0 "$DIST/$2.sig")"
  printf '"%s":{"file":"%s","sha256":"%s","signature":"%s"}' "$1" "$2" "$sha" "$sig"
}

echo "==> Publishing linux-x64 (version $VERSION)"
"$DOTNET" publish "$PROJECT" -c Release -r linux-x64 \
  -p:CppCompilerAndLinker=gcc -p:Version="$VERSION" > /dev/null
stage "$PROJECT/bin/Release/net10.0/linux-x64/publish/NodeScope.Agent" nodescope-agent-linux-x64
ENTRIES="$(manifest_entry linux-x64 nodescope-agent-linux-x64)"

# NativeAOT must link on Windows for win-x64; use the Windows host's SDK when
# this is WSL and dotnet.exe is on the interop PATH.
if command -v dotnet.exe > /dev/null 2>&1 && dotnet.exe --list-sdks > /dev/null 2>&1; then
  echo "==> Publishing win-x64 via the Windows host's dotnet.exe"
  dotnet.exe publish "$PROJECT" -c Release -r win-x64 -p:Version="$VERSION" > /dev/null
  stage "$PROJECT/bin/Release/net10.0/win-x64/publish/NodeScope.Agent.exe" nodescope-agent-win-x64.exe
  ENTRIES="$ENTRIES,$(manifest_entry win-x64 nodescope-agent-win-x64.exe)"
else
  echo "==> Skipping win-x64: no working dotnet.exe on the interop PATH" >&2
fi

printf '{"version":"%s","binaries":{%s}}\n' "$VERSION" "$ENTRIES" > "$DIST/manifest.json"

cp deploy/agent/install.sh deploy/agent/install.ps1 deploy/agent/nodescope-agent.service "$DIST/"

echo "==> Staged $VERSION:"
ls -l "$DIST"
