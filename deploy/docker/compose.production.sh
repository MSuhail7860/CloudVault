#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
ENV_FILE="${PRODUCTION_ENV_FILE:-$SCRIPT_DIR/.env.production}"
COMPOSE_FILE="$SCRIPT_DIR/compose.production.yaml"

python3 "$SCRIPT_DIR/production-config-check.py" \
  --env-file "$ENV_FILE" \
  --compose-file "$COMPOSE_FILE"

exec docker compose \
  --project-name cloudvault-production \
  --project-directory "$REPOSITORY_ROOT" \
  --env-file "$ENV_FILE" \
  --file "$COMPOSE_FILE" \
  "$@"
