#!/usr/bin/env bash
#
# Sign already-published agent binaries and create the appliance payload.
#
# Usage:
#   scripts/agent-release/stage.sh \
#     --version 0.1.1 \
#     --input out/raw-agent \
#     --output deploy/agent-dist \
#     --key ~/.nodescope/agent-signing.key
set -euo pipefail

ROOT="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

VERSION=""
INPUT=""
OUTPUT="deploy/agent-dist"
KEY_PATH="${NODESCOPE_AGENT_SIGNING_KEY:-$HOME/.nodescope/agent-signing.key}"

while [ $# -gt 0 ]; do
  case "$1" in
    --version) [ $# -ge 2 ] || { echo "--version requires a value" >&2; exit 1; }; VERSION="$2"; shift 2 ;;
    --input) [ $# -ge 2 ] || { echo "--input requires a value" >&2; exit 1; }; INPUT="$2"; shift 2 ;;
    --output) [ $# -ge 2 ] || { echo "--output requires a value" >&2; exit 1; }; OUTPUT="$2"; shift 2 ;;
    --key) [ $# -ge 2 ] || { echo "--key requires a value" >&2; exit 1; }; KEY_PATH="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] \
  || { echo "Version must be numeric, for example 0.1.1" >&2; exit 1; }
[ -n "$INPUT" ] || { echo "--input is required" >&2; exit 1; }
[ -d "$INPUT" ] || { echo "Input directory does not exist: $INPUT" >&2; exit 1; }
[ -f "$KEY_PATH" ] || { echo "Signing key does not exist: $KEY_PATH" >&2; exit 1; }

OUTPUT_ABS="$(realpath -m "$OUTPUT")"
case "$OUTPUT_ABS" in
  "$ROOT/deploy/agent-dist"|"$ROOT/out/"*) ;;
  *)
    echo "Output must be deploy/agent-dist or a directory beneath out/: $OUTPUT_ABS" >&2
    exit 1
    ;;
esac

ACTUAL_PUBLIC_KEY="$(openssl ec -in "$KEY_PATH" -pubout 2>/dev/null)"
for pin_file in \
  src/NodeScope.Agent/SelfUpdate.cs \
  deploy/agent/install.sh \
  deploy/agent/install.ps1
do
  pinned="$(
    sed -n '/-----BEGIN PUBLIC KEY-----/,/-----END PUBLIC KEY-----/p' "$pin_file" \
      | sed \
          -e 's/.*-----BEGIN PUBLIC KEY-----/-----BEGIN PUBLIC KEY-----/' \
          -e 's/-----END PUBLIC KEY-----.*/-----END PUBLIC KEY-----/' \
          -e 's/^ *//'
  )"
  if [ "$pinned" != "$ACTUAL_PUBLIC_KEY" ]; then
    echo "Signing key does not match the public key in $pin_file" >&2
    exit 1
  fi
done

mkdir -p "$OUTPUT_ABS"
find "$OUTPUT_ABS" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
touch "$OUTPUT_ABS/.gitkeep"

platforms=(linux-x64 linux-arm64 win-x64)
files=(
  nodescope-agent-linux-x64
  nodescope-agent-linux-arm64
  nodescope-agent-win-x64.exe
)

entries=""
staged=0
for index in "${!platforms[@]}"; do
  platform="${platforms[$index]}"
  file="${files[$index]}"
  source_file="$INPUT/$file"
  [ -f "$source_file" ] || continue

  cp "$source_file" "$OUTPUT_ABS/$file"
  chmod 755 "$OUTPUT_ABS/$file"
  openssl dgst -sha256 \
    -sign "$KEY_PATH" \
    -out "$OUTPUT_ABS/$file.sig" \
    "$OUTPUT_ABS/$file"
  (
    cd "$OUTPUT_ABS"
    sha256sum "$file" >"$file.sha256"
  )
  openssl dgst -sha256 \
    -verify <(printf '%s\n' "$ACTUAL_PUBLIC_KEY") \
    -signature "$OUTPUT_ABS/$file.sig" \
    "$OUTPUT_ABS/$file" \
    >/dev/null

  sha="$(cut -d' ' -f1 "$OUTPUT_ABS/$file.sha256")"
  signature="$(base64 -w0 "$OUTPUT_ABS/$file.sig")"
  [ -z "$entries" ] || entries+=","
  entries+="\"$platform\":{\"file\":\"$file\",\"sha256\":\"$sha\",\"signature\":\"$signature\"}"
  staged=$((staged + 1))
done

[ "$staged" -gt 0 ] || { echo "No supported agent binaries found in $INPUT" >&2; exit 1; }

printf '{"version":"%s","binaries":{%s}}\n' "$VERSION" "$entries" >"$OUTPUT_ABS/manifest.json"
cp \
  deploy/agent/install.sh \
  deploy/agent/install.ps1 \
  deploy/agent/nodescope-agent.service \
  "$OUTPUT_ABS/"
chmod 755 "$OUTPUT_ABS/install.sh"

echo "Staged $staged signed agent binaries for version $VERSION in $OUTPUT_ABS"
