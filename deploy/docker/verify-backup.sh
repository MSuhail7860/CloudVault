#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BACKUP_HMAC_KEY_FILE_OVERRIDE="${BACKUP_HMAC_KEY_FILE:-}"
BACKUP_AUTH_REQUIRED_OVERRIDE="${BACKUP_AUTH_REQUIRED:-}"
if [ $# -ne 1 ]; then
  echo "Usage: $0 <BACKUP_DIRECTORY>" >&2
  exit 1
fi

if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$SCRIPT_DIR/.env"
  set +a
fi
if [ -n "$BACKUP_HMAC_KEY_FILE_OVERRIDE" ]; then
  BACKUP_HMAC_KEY_FILE="$BACKUP_HMAC_KEY_FILE_OVERRIDE"
fi
if [ -n "$BACKUP_AUTH_REQUIRED_OVERRIDE" ]; then
  BACKUP_AUTH_REQUIRED="$BACKUP_AUTH_REQUIRED_OVERRIDE"
fi

exec python3 "$SCRIPT_DIR/backup-integrity.py" verify "$1" \
  --expected-project cloudvault-app-docker \
  --expected-bucket "${APP_S3_BUCKET:-cloudvault-app-files}"
