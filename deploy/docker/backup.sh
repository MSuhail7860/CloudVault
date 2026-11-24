#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENV_FILE="${BACKUP_ENV_FILE:-$SCRIPT_DIR/.env}"
COMPOSE_SH="${BACKUP_COMPOSE_SH:-$SCRIPT_DIR/compose.sh}"
INTEGRITY_TOOL="$SCRIPT_DIR/backup-integrity.py"
CONFIGURED_ENV_FILE="$ENV_FILE"
CONFIGURED_COMPOSE_SH="$COMPOSE_SH"
BACKUP_TEST_MODE_OVERRIDE="${BACKUP_TEST_MODE:-}"
BACKUP_HMAC_KEY_FILE_OVERRIDE="${BACKUP_HMAC_KEY_FILE:-}"
BACKUP_AUTH_REQUIRED_OVERRIDE="${BACKUP_AUTH_REQUIRED:-}"
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: deploy/docker/.env is missing. Run deploy/docker/setup.sh first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

ENV_FILE="$CONFIGURED_ENV_FILE"
COMPOSE_SH="$CONFIGURED_COMPOSE_SH"
BACKUP_TEST_MODE="$BACKUP_TEST_MODE_OVERRIDE"
if [ -n "$BACKUP_HMAC_KEY_FILE_OVERRIDE" ]; then
  BACKUP_HMAC_KEY_FILE="$BACKUP_HMAC_KEY_FILE_OVERRIDE"
fi
if [ -n "$BACKUP_AUTH_REQUIRED_OVERRIDE" ]; then
  BACKUP_AUTH_REQUIRED="$BACKUP_AUTH_REQUIRED_OVERRIDE"
fi
if [ "$COMPOSE_SH" != "$SCRIPT_DIR/compose.sh" ] && [ "$BACKUP_TEST_MODE" != "true" ]; then
  echo "Error: A custom Compose target is permitted only in explicit test mode." >&2
  exit 1
fi
if [ "$COMPOSE_SH" = "$SCRIPT_DIR/compose.sh" ] && [ "$BACKUP_TEST_MODE" = "true" ]; then
  echo "Error: Backup simulations require a mock Compose command; live Docker is not permitted." >&2
  exit 1
fi

DB_USER="${APP_DB_USER:-cloudvault_app}"
DB_NAME="${APP_DB_NAME:-cloudvault_app}"
S3_BUCKET="${APP_S3_BUCKET:-cloudvault-app-files}"
PROJECT="cloudvault-app-docker"
TIMESTAMP=$(date -u +"%Y%m%d_%H%M%SZ")
TARGET_DIR="${1:-$SCRIPT_DIR/backups/backup-$TIMESTAMP}"

if [ -e "$TARGET_DIR" ] || [ -L "$TARGET_DIR" ]; then
  echo "Error: Backup destination already exists; refusing to overwrite it." >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET_DIR")"
TARGET_DIR=$(CDPATH= cd -- "$(dirname "$TARGET_DIR")" && pwd)/$(basename "$TARGET_DIR")
umask 077

API_WAS_RUNNING=false
WORKER_WAS_RUNNING=false
SERVICES_MAY_BE_STOPPED=false
CURRENT_STAGE="backup initialization"
TMP_BACKUP_DIR=""

cleanup() {
  STATUS=$?
  trap - EXIT INT TERM

  if [ "$STATUS" -ne 0 ]; then
    echo "ERROR: Backup failed during $CURRENT_STAGE." >&2
  fi
  if [ "$SERVICES_MAY_BE_STOPPED" = "true" ]; then
    echo "==> Restoring the original API/worker running state..."
    RECOVERY_STATUS=0
    if [ "$API_WAS_RUNNING" = "true" ] && [ "$WORKER_WAS_RUNNING" = "true" ]; then
      "$COMPOSE_SH" start api worker >/dev/null 2>&1 || RECOVERY_STATUS=$?
    elif [ "$API_WAS_RUNNING" = "true" ]; then
      "$COMPOSE_SH" start api >/dev/null 2>&1 || RECOVERY_STATUS=$?
    elif [ "$WORKER_WAS_RUNNING" = "true" ]; then
      "$COMPOSE_SH" start worker >/dev/null 2>&1 || RECOVERY_STATUS=$?
    fi
    if [ "$RECOVERY_STATUS" -eq 0 ]; then
      echo "==> Original service state restored."
    else
      echo "ERROR: API/worker recovery failed; manual service intervention is required." >&2
      STATUS=1
    fi
  fi

  if [ -n "$TMP_BACKUP_DIR" ] && [ -d "$TMP_BACKUP_DIR" ]; then
    rm -rf "$TMP_BACKUP_DIR"
  fi
  exit "$STATUS"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

TMP_BACKUP_DIR=$(mktemp -d "${TARGET_DIR}.tmp.XXXXXX")
mkdir "$TMP_BACKUP_DIR/objects"

echo "==> Starting isolated CloudVault backup"
echo "Target directory: $TARGET_DIR"

CURRENT_STAGE="deployment target validation"
TARGET_PROJECT=$("$COMPOSE_SH" target)
if [ "$TARGET_PROJECT" != "$PROJECT" ]; then
  echo "Error: Refusing backup from unexpected Compose project." >&2
  exit 1
fi

RUNNING_SERVICES=$("$COMPOSE_SH" ps --status running --format '{{.Service}}')
for REQUIRED in postgres minio; do
  if ! printf '%s\n' "$RUNNING_SERVICES" | grep -q "^$REQUIRED$"; then
    echo "Error: Required local service '$REQUIRED' is not running." >&2
    exit 1
  fi
done
printf '%s\n' "$RUNNING_SERVICES" | grep -q '^api$' && API_WAS_RUNNING=true || true
printf '%s\n' "$RUNNING_SERVICES" | grep -q '^worker$' && WORKER_WAS_RUNNING=true || true

CURRENT_STAGE="quiescing API and worker"
echo "==> Pausing running API and worker services..."
if [ "$API_WAS_RUNNING" = "true" ] && [ "$WORKER_WAS_RUNNING" = "true" ]; then
  SERVICES_MAY_BE_STOPPED=true
  "$COMPOSE_SH" stop api worker >/dev/null
elif [ "$API_WAS_RUNNING" = "true" ]; then
  SERVICES_MAY_BE_STOPPED=true
  "$COMPOSE_SH" stop api >/dev/null
elif [ "$WORKER_WAS_RUNNING" = "true" ]; then
  SERVICES_MAY_BE_STOPPED=true
  "$COMPOSE_SH" stop worker >/dev/null
fi

CURRENT_STAGE="PostgreSQL dump"
echo "==> Dumping PostgreSQL database..."
"$COMPOSE_SH" exec -T postgres pg_dump \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges > "$TMP_BACKUP_DIR/database.sql"
if [ ! -s "$TMP_BACKUP_DIR/database.sql" ]; then
  echo "Error: Database dump file is empty." >&2
  exit 1
fi

CURRENT_STAGE="MinIO object copy"
echo "==> Copying objects from the selected local bucket..."
ABS_TMP_DIR=$(CDPATH= cd -- "$TMP_BACKUP_DIR" && pwd)
"$COMPOSE_SH" run --rm \
  -v "$ABS_TMP_DIR/objects:/backup" \
  --entrypoint /bin/sh \
  minio-init -c '
    set -e
    mkdir -p /tmp/mc
    export MC_CONFIG_DIR=/tmp/mc
    mc alias set app http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc mirror --overwrite "app/$APP_S3_BUCKET" /backup
  '

CURRENT_STAGE="resuming original API/worker state"
cleanup_status=0
if [ "$API_WAS_RUNNING" = "true" ] && [ "$WORKER_WAS_RUNNING" = "true" ]; then
  "$COMPOSE_SH" start api worker >/dev/null || cleanup_status=$?
elif [ "$API_WAS_RUNNING" = "true" ]; then
  "$COMPOSE_SH" start api >/dev/null || cleanup_status=$?
elif [ "$WORKER_WAS_RUNNING" = "true" ]; then
  "$COMPOSE_SH" start worker >/dev/null || cleanup_status=$?
fi
if [ "$cleanup_status" -ne 0 ]; then
  echo "Error: Could not resume the previously running API/worker services." >&2
  exit 1
fi
SERVICES_MAY_BE_STOPPED=false

CURRENT_STAGE="manifest creation and integrity verification"
echo "==> Creating manifest and verifying backup contents..."
python3 "$INTEGRITY_TOOL" create "$TMP_BACKUP_DIR" \
  --project "$PROJECT" \
  --database-name "$DB_NAME" \
  --database-user "$DB_USER" \
  --bucket "$S3_BUCKET" \
  --timestamp "$TIMESTAMP"
python3 "$INTEGRITY_TOOL" verify "$TMP_BACKUP_DIR" \
  --expected-project "$PROJECT" \
  --expected-bucket "$S3_BUCKET"

if [ -e "$TARGET_DIR" ] || [ -L "$TARGET_DIR" ]; then
  echo "Error: Backup destination appeared during backup; refusing to overwrite it." >&2
  exit 1
fi
mv "$TMP_BACKUP_DIR" "$TARGET_DIR"
trap - EXIT INT TERM

echo "==> Backup completed successfully."
echo "Location: $TARGET_DIR"
echo "SHA-256 checksums detect accidental corruption; they do not authenticate the backup."
if [ -n "${BACKUP_HMAC_KEY_FILE:-}" ]; then
  echo "Authenticated HMAC manifest created using the configured external key file."
else
  echo "Manifest is checksum-only; configure BACKUP_HMAC_KEY_FILE for tamper authentication."
fi
