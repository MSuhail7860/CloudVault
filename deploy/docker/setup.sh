#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENV_FILE="$SCRIPT_DIR/.env"
CAPTURE_DIR="$SCRIPT_DIR/mail-capture"

if [ ! -e "$ENV_FILE" ]; then
  command -v openssl >/dev/null 2>&1 || {
    echo "openssl is required to generate local-only credentials" >&2
    exit 1
  }
  umask 077
  {
    printf 'APP_DB_NAME=cloudvault_app\n'
    printf 'APP_DB_USER=cloudvault_app\n'
    printf 'APP_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'REDIS_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'MINIO_ROOT_USER=cloudvault-root-%s\n' "$(openssl rand -hex 8)"
    printf 'MINIO_ROOT_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'APP_S3_ACCESS_KEY_ID=cloudvault-app-%s\n' "$(openssl rand -hex 8)"
    printf 'APP_S3_SECRET_ACCESS_KEY=%s\n' "$(openssl rand -hex 32)"
    printf 'JWT_ACCESS_SECRET=%s\n' "$(openssl rand -hex 32)"
    printf 'JWT_REFRESH_SECRET=%s\n' "$(openssl rand -hex 32)"
    printf 'FRONTEND_HOST_PORT=38080\n'
    printf 'MINIO_CONSOLE_HOST_PORT=39001\n'
    printf 'APP_HOST_UID=%s\n' "$(id -u)"
    printf 'APP_HOST_GID=%s\n' "$(id -g)"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Generated deploy/docker/.env with separate random local credentials."
else
  echo "deploy/docker/.env already exists; it was left unchanged."
fi

mkdir -p "$CAPTURE_DIR"
chmod 700 "$CAPTURE_DIR"
