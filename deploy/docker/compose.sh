#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
ENV_FILE="$SCRIPT_DIR/.env"

if [ "${1:-}" = "target" ]; then
  printf '%s\n' "cloudvault-app-docker"
  exit 0
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Local Docker environment is missing; run deploy/docker/setup.sh first." >&2
  exit 1
fi

unset POSTGRES_VOLUME_NAME REDIS_VOLUME_NAME MINIO_VOLUME_NAME
unset APP_INTERNAL_NETWORK_NAME APP_EDGE_NETWORK_NAME MAIL_CAPTURE_DIRECTORY
unset APP_BACKEND_IMAGE APP_MIGRATOR_IMAGE APP_FRONTEND_IMAGE

exec docker compose \
  --project-name cloudvault-app-docker \
  --project-directory "$REPOSITORY_ROOT" \
  --env-file "$ENV_FILE" \
  --file "$REPOSITORY_ROOT/deploy/docker/compose.yaml" \
  "$@"
