#!/bin/sh
# Compatibility entry point. New automation should call:
#   deploy/nodescope.sh backup [output-dir]
set -eu

# shellcheck disable=SC1007
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec "${DIR}/nodescope.sh" backup "$@"
