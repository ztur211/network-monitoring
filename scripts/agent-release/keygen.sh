#!/usr/bin/env bash
# One-time creation of the NodeScope agent publisher keypair (Decision 13).
#
# The private key signs every released agent binary; the public half is pinned
# in src/NodeScope.Agent/SelfUpdate.cs and deploy/agent/install.sh. Regenerating
# the key ORPHANS EVERY DEPLOYED AGENT (their pinned key stops matching all
# future releases), so this script refuses to overwrite an existing key.
set -euo pipefail

KEY_PATH="${NODESCOPE_AGENT_SIGNING_KEY:-$HOME/.nodescope/agent-signing.key}"

if [[ -f "$KEY_PATH" ]]; then
  echo "Refusing to overwrite existing key: $KEY_PATH" >&2
  echo "Public half:" >&2
  openssl ec -in "$KEY_PATH" -pubout 2>/dev/null
  exit 1
fi

mkdir -p "$(dirname "$KEY_PATH")"
openssl ecparam -name prime256v1 -genkey -noout -out "$KEY_PATH"
chmod 600 "$KEY_PATH"

echo "Created $KEY_PATH. Pin this public key in SelfUpdate.cs and install.sh:"
openssl ec -in "$KEY_PATH" -pubout 2>/dev/null
