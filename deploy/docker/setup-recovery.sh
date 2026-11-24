#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENV_FILE="$SCRIPT_DIR/.env.recovery"
CAPTURE_DIR="$SCRIPT_DIR/mail-capture-recovery"

if [ ! -e "$ENV_FILE" ]; then
  command -v openssl >/dev/null 2>&1 || {
    echo "openssl is required to generate isolated recovery credentials" >&2
    exit 1
  }
  umask 077
  {
    printf 'APP_DB_NAME=cloudvault_recovery\n'
    printf 'APP_DB_USER=cloudvault_recovery\n'
    printf 'APP_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'REDIS_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'MINIO_ROOT_USER=cloudvault-recovery-%s\n' "$(openssl rand -hex 8)"
    printf 'MINIO_ROOT_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'APP_S3_BUCKET=cloudvault-app-files\n'
    printf 'APP_S3_ACCESS_KEY_ID=cloudvault-recovery-app-%s\n' "$(openssl rand -hex 8)"
    printf 'APP_S3_SECRET_ACCESS_KEY=%s\n' "$(openssl rand -hex 32)"
    printf 'JWT_ACCESS_SECRET=%s\n' "$(openssl rand -hex 32)"
    printf 'JWT_REFRESH_SECRET=%s\n' "$(openssl rand -hex 32)"
    printf 'FRONTEND_HOST_PORT=38081\n'
    printf 'MINIO_CONSOLE_HOST_PORT=39002\n'
    printf 'APP_HOST_UID=%s\n' "$(id -u)"
    printf 'APP_HOST_GID=%s\n' "$(id -g)"
    printf 'POSTGRES_VOLUME_NAME=cloudvault-app-recovery-postgres-data\n'
    printf 'REDIS_VOLUME_NAME=cloudvault-app-recovery-redis-data\n'
    printf 'MINIO_VOLUME_NAME=cloudvault-app-recovery-minio-data\n'
    printf 'APP_INTERNAL_NETWORK_NAME=cloudvault-app-recovery-internal\n'
    printf 'APP_EDGE_NETWORK_NAME=cloudvault-app-recovery-edge\n'
    printf 'MAIL_CAPTURE_DIRECTORY=./deploy/docker/mail-capture-recovery\n'
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Generated deploy/docker/.env.recovery with isolated recovery resources and credentials."
else
  echo "deploy/docker/.env.recovery already exists; it was left unchanged."
fi

mkdir -p "$CAPTURE_DIR"
chmod 700 "$CAPTURE_DIR"
