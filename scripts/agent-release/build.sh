#!/usr/bin/env bash
#
# Build locally supported NativeAOT agent binaries, then stage and sign them for
# the appliance. Linux x64 is always built. Windows x64 is also built when a
# working Windows dotnet.exe is available from WSL.
#
# Usage:
#   scripts/agent-release/build.sh [--version 0.1.1]
set -euo pipefail

ROOT="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

DOTNET="${DOTNET:-$HOME/.dotnet/dotnet}"
KEY_PATH="${NODESCOPE_AGENT_SIGNING_KEY:-$HOME/.nodescope/agent-signing.key}"
PROJECT="src/NodeScope.Agent"
VERSION=""

while [ $# -gt 0 ]; do
  case "$1" in
    --version) [ $# -ge 2 ] || { echo "--version requires a value" >&2; exit 1; }; VERSION="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$VERSION" ]; then
  VERSION="$(sed -n 's/.*<Version>\(.*\)<\/Version>.*/\1/p' "$PROJECT/NodeScope.Agent.csproj")"
fi
[ -n "$VERSION" ] || { echo "Could not determine the agent version" >&2; exit 1; }
[ -x "$DOTNET" ] || { echo "dotnet executable not found: $DOTNET" >&2; exit 1; }

RAW="$(mktemp -d)"
trap 'rm -rf "$RAW"' EXIT

echo "Publishing linux-x64 agent $VERSION"
"$DOTNET" publish "$PROJECT" \
  --configuration Release \
  --runtime linux-x64 \
  --output "$RAW/linux-x64" \
  -p:CppCompilerAndLinker=gcc \
  -p:Version="$VERSION" \
  >/dev/null
cp "$RAW/linux-x64/NodeScope.Agent" "$RAW/nodescope-agent-linux-x64"

DOTNET_EXE=""
if command -v dotnet.exe >/dev/null 2>&1; then
  DOTNET_EXE="dotnet.exe"
elif [ -x "/mnt/c/Program Files/dotnet/dotnet.exe" ]; then
  DOTNET_EXE="/mnt/c/Program Files/dotnet/dotnet.exe"
fi

if [ -n "$DOTNET_EXE" ] && "$DOTNET_EXE" --list-sdks >/dev/null 2>&1; then
  echo "Publishing win-x64 agent with the Windows SDK"
  WIN_LOCALAPPDATA="$(/mnt/c/Windows/System32/cmd.exe /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')"
  if [ -z "$WIN_LOCALAPPDATA" ] || [[ "$WIN_LOCALAPPDATA" == *%* ]]; then
    echo "Skipping win-x64 because Windows LOCALAPPDATA could not be resolved" >&2
  else
    WIN_ARTIFACTS="$WIN_LOCALAPPDATA\\NodeScope\\agent-build"
    "$DOTNET_EXE" publish "$(wslpath -w "$PROJECT")" \
      --configuration Release \
      --runtime win-x64 \
      --artifacts-path "$WIN_ARTIFACTS" \
      -p:Version="$VERSION" \
      >/dev/null
    cp \
      "$(wslpath "$WIN_ARTIFACTS")/publish/NodeScope.Agent/release_win-x64/NodeScope.Agent.exe" \
      "$RAW/nodescope-agent-win-x64.exe"
  fi
else
  echo "Skipping win-x64 because no working Windows dotnet.exe was found" >&2
fi

scripts/agent-release/stage.sh \
  --version "$VERSION" \
  --input "$RAW" \
  --output deploy/agent-dist \
  --key "$KEY_PATH"

find deploy/agent-dist -maxdepth 1 -type f -printf '%f\n' | sort
