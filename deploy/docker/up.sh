#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$SCRIPT_DIR/setup.sh"
exec "$SCRIPT_DIR/compose.sh" up --detach --build --wait
