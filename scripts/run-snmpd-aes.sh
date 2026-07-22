#!/usr/bin/env bash
# Starts the net-snmp reference daemon for the SNMPv3 AES-256 key-extension
# matrix tests (tests/NodeScope.Agent.Tests/SnmpV3AesVariantTests.cs).
#
# Alpine's net-snmp is compiled with --enable-blumenthal-aes, so it offers BOTH
# AES-256 key-extension variants: "AES-256" (draft-blumenthal-aes-usm-04) and
# "AES-256-C" (Reeder/Cisco, what real gear predominantly implements). One user
# per (auth, variant) pair makes the daemon the reference instrument that pins
# down which variant SharpSnmpLib speaks.
#
# Usage:
#   scripts/run-snmpd-aes.sh          # start (binds host UDP 161)
#   scripts/run-snmpd-aes.sh stop     # remove the container
#
# Then:
#   export PATH="$HOME/.dotnet:$PATH"
#   NODESCOPE_SNMPD_HOST=127.0.0.1 dotnet test tests/NodeScope.Agent.Tests \
#     --filter SnmpV3AesVariantTests
set -euo pipefail

NAME=nodescope-snmpd-aes

if [[ "${1:-}" == "stop" ]]; then
  docker rm -f "$NAME" > /dev/null 2>&1 || true
  echo "$NAME removed"
  exit 0
fi

CONF="$(mktemp -d)/snmpd.conf"
cat > "$CONF" <<'EOF'
createUser md5b MD5 authpass12 AES-256 privpass12
createUser md5c MD5 authpass12 AES-256-C privpass12
createUser sha1b SHA-1 authpass12 AES-256 privpass12
createUser sha1c SHA-1 authpass12 AES-256-C privpass12
createUser sha256b SHA-256 authpass12 AES-256 privpass12
createUser sha256c SHA-256 authpass12 AES-256-C privpass12
rouser md5b priv
rouser md5c priv
rouser sha1b priv
rouser sha1c priv
rouser sha256b priv
rouser sha256c priv
EOF

docker rm -f "$NAME" > /dev/null 2>&1 || true
docker run -d --name "$NAME" -p 161:161/udp \
  -v "$CONF:/etc/snmp/snmpd.conf:ro" alpine:3.22 \
  sh -c 'apk add -q net-snmp net-snmp-tools && exec snmpd -f -Le udp:161' > /dev/null

# The users only exist once snmpd has parsed the config; prove each one answers
# before handing the daemon to the tests.
sleep 3
for spec in md5b:MD5:AES-256 md5c:MD5:AES-256-C sha1b:SHA-1:AES-256 \
            sha1c:SHA-1:AES-256-C sha256b:SHA-256:AES-256 sha256c:SHA-256:AES-256-C; do
  IFS=: read -r user auth priv <<< "$spec"
  docker exec "$NAME" snmpget -v3 -u "$user" -l authPriv -a "$auth" -A authpass12 \
    -x "$priv" -X privpass12 -t 2 -r 1 localhost sysUpTime.0 > /dev/null \
    || { echo "self-check failed for $user ($auth/$priv)" >&2; exit 1; }
done

echo "$NAME ready on udp/161 (NODESCOPE_SNMPD_HOST=127.0.0.1)"
