#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
ENV_FILE="$SCRIPT_DIR/.env.recovery"

if [ "${1:-}" = "target" ]; then
  printf '%s\n' "cloudvault-app-recovery"
  exit 0
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Isolated recovery environment is missing; run deploy/docker/setup-recovery.sh first." >&2
  exit 1
fi

for setting in \
  APP_DB_NAME=cloudvault_recovery \
  APP_DB_USER=cloudvault_recovery \
  FRONTEND_HOST_PORT=38081 \
  MINIO_CONSOLE_HOST_PORT=39002 \
  POSTGRES_VOLUME_NAME=cloudvault-app-recovery-postgres-data \
  REDIS_VOLUME_NAME=cloudvault-app-recovery-redis-data \
  MINIO_VOLUME_NAME=cloudvault-app-recovery-minio-data \
  APP_INTERNAL_NETWORK_NAME=cloudvault-app-recovery-internal \
  APP_EDGE_NETWORK_NAME=cloudvault-app-recovery-edge \
  MAIL_CAPTURE_DIRECTORY=./deploy/docker/mail-capture-recovery
do
  setting_name=${setting%%=*}
  setting_count=$(grep -c "^${setting_name}=" "$ENV_FILE" || true)
  if [ "$setting_count" -ne 1 ] || ! grep -Fqx "$setting" "$ENV_FILE"; then
    echo "Recovery environment is not isolated: expected $setting." >&2
    exit 1
  fi
done

unset APP_DB_NAME APP_DB_USER APP_DB_PASSWORD REDIS_PASSWORD
unset MINIO_ROOT_USER MINIO_ROOT_PASSWORD APP_S3_BUCKET
unset APP_S3_ACCESS_KEY_ID APP_S3_SECRET_ACCESS_KEY JWT_ACCESS_SECRET JWT_REFRESH_SECRET
unset FRONTEND_HOST_PORT MINIO_CONSOLE_HOST_PORT APP_HOST_UID APP_HOST_GID
unset POSTGRES_VOLUME_NAME REDIS_VOLUME_NAME MINIO_VOLUME_NAME
unset APP_INTERNAL_NETWORK_NAME APP_EDGE_NETWORK_NAME MAIL_CAPTURE_DIRECTORY

APP_BACKEND_IMAGE=cloudvault-app-recovery-backend:local \
APP_MIGRATOR_IMAGE=cloudvault-app-recovery-migrator:local \
APP_FRONTEND_IMAGE=cloudvault-app-recovery-frontend:local \
exec docker compose \
  --project-name cloudvault-app-recovery \
  --project-directory "$REPOSITORY_ROOT" \
  --env-file "$ENV_FILE" \
  --file "$REPOSITORY_ROOT/deploy/docker/compose.yaml" \
  "$@"
