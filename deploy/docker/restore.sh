#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INTEGRITY_TOOL="$SCRIPT_DIR/backup-integrity.py"
: "${COMPOSE_SH:="$SCRIPT_DIR/compose.recovery.sh"}"
: "${RESTORE_ENV_FILE:="$SCRIPT_DIR/.env.recovery"}"
SOURCE_PROJECT="cloudvault-app-docker"
RECOVERY_PROJECT="cloudvault-app-recovery"
CONFIGURED_COMPOSE_SH="$COMPOSE_SH"
CONFIGURED_ENV_FILE="$RESTORE_ENV_FILE"
RESTORE_TEST_MODE_OVERRIDE="${RESTORE_TEST_MODE:-}"
RESTORE_FAIL_STAGE_OVERRIDE="${RESTORE_FAIL_STAGE:-}"
RESTORE_READINESS_ATTEMPTS_OVERRIDE="${RESTORE_READINESS_ATTEMPTS:-}"
RESTORE_EXCLUDED_PREFIXES_OVERRIDE="${RESTORE_EXCLUDED_OBJECT_PREFIXES:-}"
BACKUP_HMAC_KEY_FILE_OVERRIDE="${BACKUP_HMAC_KEY_FILE:-}"
BACKUP_AUTH_REQUIRED_OVERRIDE="${BACKUP_AUTH_REQUIRED:-}"

if [ $# -ne 1 ]; then
  echo "Usage: $0 <BACKUP_DIRECTORY>" >&2
  exit 1
fi
BACKUP_DIR="$1"
if [ -L "$BACKUP_DIR" ]; then
  echo "Error: Backup directory must not be a symbolic link." >&2
  exit 1
fi
if [ ! -d "$BACKUP_DIR" ]; then
  echo "Error: Backup directory does not exist." >&2
  exit 1
fi
BACKUP_DIR=$(CDPATH= cd -- "$BACKUP_DIR" && pwd)

if [ ! -f "$RESTORE_ENV_FILE" ]; then
  echo "Error: Restore environment file is missing." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$RESTORE_ENV_FILE"
set +a
COMPOSE_SH="$CONFIGURED_COMPOSE_SH"
RESTORE_ENV_FILE="$CONFIGURED_ENV_FILE"
RESTORE_TEST_MODE="$RESTORE_TEST_MODE_OVERRIDE"
RESTORE_FAIL_STAGE="$RESTORE_FAIL_STAGE_OVERRIDE"
if [ -n "$RESTORE_READINESS_ATTEMPTS_OVERRIDE" ]; then
  RESTORE_READINESS_ATTEMPTS="$RESTORE_READINESS_ATTEMPTS_OVERRIDE"
fi
if [ -n "$RESTORE_EXCLUDED_PREFIXES_OVERRIDE" ]; then
  RESTORE_EXCLUDED_OBJECT_PREFIXES="$RESTORE_EXCLUDED_PREFIXES_OVERRIDE"
fi
if [ -n "$BACKUP_HMAC_KEY_FILE_OVERRIDE" ]; then
  BACKUP_HMAC_KEY_FILE="$BACKUP_HMAC_KEY_FILE_OVERRIDE"
fi
if [ -n "$BACKUP_AUTH_REQUIRED_OVERRIDE" ]; then
  BACKUP_AUTH_REQUIRED="$BACKUP_AUTH_REQUIRED_OVERRIDE"
fi

if [ -n "$RESTORE_FAIL_STAGE" ] && [ "$RESTORE_TEST_MODE" != "true" ]; then
  echo "Error: RESTORE_FAIL_STAGE is allowed only with RESTORE_TEST_MODE=true." >&2
  exit 1
fi
case "$RESTORE_FAIL_STAGE" in
  ""|before_database|during_database|after_database|minio_sync|object_validation|service_start|readiness) ;;
  *)
    echo "Error: Unknown restore failure-injection stage." >&2
    exit 1
    ;;
esac
if [ "$RESTORE_TEST_MODE" != "true" ] &&
  { [ "$COMPOSE_SH" != "$SCRIPT_DIR/compose.recovery.sh" ] ||
    [ "$RESTORE_ENV_FILE" != "$SCRIPT_DIR/.env.recovery" ]; }; then
  echo "Error: Restore must use the dedicated recovery Compose project and environment; local application restore is prohibited." >&2
  exit 1
fi

DB_USER="${APP_DB_USER:-cloudvault_app}"
DB_NAME="${APP_DB_NAME:-cloudvault_app}"
S3_BUCKET="${APP_S3_BUCKET:-cloudvault-app-files}"
READINESS_ATTEMPTS="${RESTORE_READINESS_ATTEMPTS:-30}"
case "$READINESS_ATTEMPTS" in
  ''|*[!0-9]*|0)
    echo "Error: RESTORE_READINESS_ATTEMPTS must be a positive integer." >&2
    exit 1
    ;;
esac

CURRENT_STAGE="backup verification"
RESTORE_TMP_DIR=""
SERVICES_MAY_BE_STOPPED=false
RECOVERY_REQUIRED=false
API_WAS_RUNNING=false
WORKER_WAS_RUNNING=false
SERVICE_STOP_FAILED=false

report_failure() {
  STATUS=$?
  trap - EXIT INT TERM
  if [ "$STATUS" -eq 0 ]; then
    exit 0
  fi

  echo "ERROR: Restore failed at stage: $CURRENT_STAGE." >&2
  if [ "$RECOVERY_REQUIRED" = "true" ]; then
    if [ "$SERVICE_STOP_FAILED" = "true" ]; then
      echo "Service stop was unsuccessful; actual API/worker state must be checked manually." >&2
    elif [ "$SERVICES_MAY_BE_STOPPED" = "true" ]; then
      echo "API and worker are intentionally left stopped because the database restore committed and database/object consistency is not established." >&2
    else
      echo "API and worker are intentionally left stopped because the database restore committed and database/object consistency is not established." >&2
      echo "API and worker were not stopped by this restore." >&2
    fi
    echo "Preserve the current database and object store, then follow the recovery runbook before restarting services." >&2
  elif [ "$SERVICES_MAY_BE_STOPPED" = "true" ]; then
    echo "==> No committed database/object mismatch is known; attempting to restore the prior API/worker running state..."
    RECOVERY_STATUS=0
    if [ "$API_WAS_RUNNING" = "true" ] && [ "$WORKER_WAS_RUNNING" = "true" ]; then
      "$COMPOSE_SH" start api worker >/dev/null 2>&1 || RECOVERY_STATUS=$?
    elif [ "$API_WAS_RUNNING" = "true" ]; then
      "$COMPOSE_SH" start api >/dev/null 2>&1 || RECOVERY_STATUS=$?
    elif [ "$WORKER_WAS_RUNNING" = "true" ]; then
      "$COMPOSE_SH" start worker >/dev/null 2>&1 || RECOVERY_STATUS=$?
    fi
    if [ "$RECOVERY_STATUS" -eq 0 ]; then
      echo "The previously running API/worker services were restarted." >&2
    else
      echo "API/worker restart failed; manual intervention is required. Check compose logs and start only the services that were previously running." >&2
    fi
  else
    echo "API and worker were not stopped by this restore." >&2
  fi
  if [ -n "$RESTORE_TMP_DIR" ] && [ -d "$RESTORE_TMP_DIR" ]; then
    rm -rf "$RESTORE_TMP_DIR" || echo "Warning: Could not remove the private temporary restore directory." >&2
  fi
  exit "$STATUS"
}
trap report_failure EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

test_inject() {
  if [ "${RESTORE_TEST_MODE:-}" = "true" ] && [ "${RESTORE_FAIL_STAGE:-}" = "$1" ]; then
    echo "Injected test failure at stage: $1" >&2
    return 1
  fi
  return 0
}

echo "==> Verifying backup integrity and target metadata..."
python3 "$INTEGRITY_TOOL" verify "$BACKUP_DIR" \
  --expected-project "$SOURCE_PROJECT" \
  --expected-bucket "$S3_BUCKET"

CURRENT_STAGE="selected Compose project validation"
TARGET_PROJECT=$("$COMPOSE_SH" target)
if [ "$TARGET_PROJECT" != "$RECOVERY_PROJECT" ]; then
  echo "Error: Compose project is not the isolated recovery deployment." >&2
  exit 1
fi

CURRENT_STAGE="service preflight"
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
echo "==> Stopping previously running API/worker services..."
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

CURRENT_STAGE="before database restoration"
test_inject before_database

CURRENT_STAGE="PostgreSQL transactional restore"
echo "==> Restoring PostgreSQL in a single transaction..."
"$COMPOSE_SH" exec -T postgres psql \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --single-transaction \
  -v ON_ERROR_STOP=1 \
  < "$BACKUP_DIR/database.sql" >/dev/null
RECOVERY_REQUIRED=true

CURRENT_STAGE="after database restoration and before MinIO synchronization"
test_inject after_database

CURRENT_STAGE="MinIO non-destructive object synchronization"
echo "==> Copying backup objects into the selected bucket without deleting existing objects..."
ABS_OBJECTS_DIR=$(CDPATH= cd -- "$BACKUP_DIR/objects" && pwd)
"$COMPOSE_SH" run --rm \
  -v "$ABS_OBJECTS_DIR:/backup:ro" \
  --entrypoint /bin/sh \
  minio-init -c '
    set -e
    mkdir -p /tmp/mc
    export MC_CONFIG_DIR=/tmp/mc
    mc alias set app http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc mirror --overwrite /backup "app/$APP_S3_BUCKET"
  '

CURRENT_STAGE="database/object-storage consistency validation"
echo "==> Checking active, intentionally retained, excluded, and unreferenced objects..."
test_inject object_validation

umask 077
RESTORE_TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/cloudvault-restore.XXXXXX")
"$COMPOSE_SH" exec -T postgres psql \
  -U "$DB_USER" -d "$DB_NAME" -t -A -F '|' -c "
    SELECT CASE WHEN \"deletedAt\" IS NULL THEN 'active' ELSE 'retained' END,
      \"ownerId\", \"storageKey\", \"size\"::text
    FROM \"File\"
    UNION ALL
    SELECT 'retained', f.\"ownerId\", v.\"storageKey\", v.\"size\"::text
    FROM \"FileVersion\" v
    JOIN \"File\" f ON f.\"id\" = v.\"fileId\"
    UNION ALL
    SELECT 'excluded', \"userId\", \"storageKey\", ''
    FROM \"StorageObjectTask\";
" > "$RESTORE_TMP_DIR/references.txt"

"$COMPOSE_SH" run --rm --entrypoint /bin/sh minio-init -c '
  set -e
  mkdir -p /tmp/mc
  export MC_CONFIG_DIR=/tmp/mc
  mc alias set app http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
  mc ls --recursive --json "app/$APP_S3_BUCKET"
' > "$RESTORE_TMP_DIR/objects.jsonl"

python3 "$SCRIPT_DIR/restore-consistency.py" \
  --references-file "$RESTORE_TMP_DIR/references.txt" \
  --objects-file "$RESTORE_TMP_DIR/objects.jsonl" \
  --excluded-prefixes "${RESTORE_EXCLUDED_OBJECT_PREFIXES:-}"

CURRENT_STAGE="API and worker startup"
echo "==> Starting previously running API/worker services..."
START_STATUS=0
if [ "$API_WAS_RUNNING" = "true" ] && [ "$WORKER_WAS_RUNNING" = "true" ]; then
  "$COMPOSE_SH" start api worker || START_STATUS=$?
elif [ "$API_WAS_RUNNING" = "true" ]; then
  "$COMPOSE_SH" start api || START_STATUS=$?
elif [ "$WORKER_WAS_RUNNING" = "true" ]; then
  "$COMPOSE_SH" start worker || START_STATUS=$?
fi
if [ "$START_STATUS" -ne 0 ]; then
  SERVICES_MAY_BE_STOPPED=true
  "$COMPOSE_SH" stop api worker >/dev/null 2>&1 || SERVICE_STOP_FAILED=true
  exit "$START_STATUS"
fi
SERVICES_MAY_BE_STOPPED=false

CURRENT_STAGE="final API readiness verification"
echo "==> Waiting for API readiness..."
ATTEMPTS=0
READY=false
while [ "$ATTEMPTS" -lt "$READINESS_ATTEMPTS" ]; do
  ATTEMPT_READY=true
  if [ "$API_WAS_RUNNING" = "true" ] &&
    ! "$COMPOSE_SH" exec -T api node -e "fetch('http://127.0.0.1:8000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ATTEMPT_READY=false
  fi
  if [ "$WORKER_WAS_RUNNING" = "true" ]; then
    RUNNING_SERVICES=$("$COMPOSE_SH" ps --status running --format '{{.Service}}')
    WORKER_HEALTH=$("$COMPOSE_SH" ps --format '{{.Service}} {{.Health}}')
    if ! printf '%s\n' "$RUNNING_SERVICES" | grep -q '^worker$' ||
      ! printf '%s\n' "$WORKER_HEALTH" | grep -q '^worker healthy$'; then
      ATTEMPT_READY=false
    fi
  fi
  if [ "$ATTEMPT_READY" = "true" ]; then
    READY=true
    break
  fi
  ATTEMPTS=$((ATTEMPTS + 1))
  sleep 1
done
if [ "$READY" != "true" ]; then
  SERVICES_MAY_BE_STOPPED=true
  "$COMPOSE_SH" stop api worker >/dev/null 2>&1 || SERVICE_STOP_FAILED=true
  RECOVERY_REQUIRED=true
  echo "Error: API/worker readiness did not succeed after $READINESS_ATTEMPTS attempt(s)." >&2
  exit 1
fi

RECOVERY_REQUIRED=false
SERVICES_MAY_BE_STOPPED=false
if [ -n "$RESTORE_TMP_DIR" ] && [ -d "$RESTORE_TMP_DIR" ]; then
  rm -rf "$RESTORE_TMP_DIR"
  RESTORE_TMP_DIR=""
fi
echo "==> Restore completed; database and object consistency validation passed."
echo "PostgreSQL was restored transactionally. PostgreSQL plus MinIO restoration is not atomic."
if [ "$API_WAS_RUNNING" = "true" ] || [ "$WORKER_WAS_RUNNING" = "true" ]; then
  echo "Previously running API/worker services are started; API readiness was verified when API was previously running."
else
  echo "API and worker were left in their original stopped state."
fi
trap - EXIT INT TERM
