import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../",
);
const DEPLOY_DIR = join(REPOSITORY_ROOT, "deploy/docker");
const RESTORE_SCRIPT = join(DEPLOY_DIR, "restore.sh");
const INTEGRITY_SCRIPT = join(DEPLOY_DIR, "backup-integrity.py");
const CONSISTENCY_SCRIPT = join(DEPLOY_DIR, "restore-consistency.py");
const PRODUCTION_CHECK = join(DEPLOY_DIR, "production-config-check.py");
const PRODUCTION_COMPOSE = join(DEPLOY_DIR, "compose.production.yaml");
const TEMP_ROOT = mkdtempSync(join(tmpdir(), "cloudvault-recovery-test-"));
const BACKUP_DIR = join(TEMP_ROOT, "source-backup");
const ENV_FILE = join(TEMP_ROOT, "restore.env");
const FAKE_COMPOSE = join(TEMP_ROOT, "fake-compose.sh");
const COMPOSE_LOG = join(TEMP_ROOT, "compose.log");
const BACKUP_ENV_FILE = join(TEMP_ROOT, "backup.env");

const runPython = (script: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
  spawnSync("python3", [script, ...args], {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });

const writeBackup = (path: string) => {
  mkdirSync(join(path, "objects", "owner"), { recursive: true });
  writeFileSync(join(path, "database.sql"), "BEGIN;\nSELECT 1;\nCOMMIT;\n");
  writeFileSync(join(path, "objects", "owner", "active"), "active-object");
  execFileSync(
    "python3",
    [
      INTEGRITY_SCRIPT,
      "create",
      path,
      "--project",
      "cloudvault-app-docker",
      "--database-name",
      "fixture",
      "--database-user",
      "fixture",
      "--bucket",
      "fixture-bucket",
      "--timestamp",
      "fixture",
    ],
    { cwd: REPOSITORY_ROOT },
  );
};

const hashTree = (root: string): string => {
  const entries = readdirSync(root, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const digest = createHash("sha256");
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      digest.update(hashTree(path));
    } else {
      digest.update(entry.name);
      digest.update(readFileSync(path));
    }
  }
  return digest.digest("hex");
};

const runRestore = (stage?: string, target = "cloudvault-app-recovery", appRunning = true) =>
  spawnSync("sh", [RESTORE_SCRIPT, BACKUP_DIR], {
    cwd: REPOSITORY_ROOT,
    env: {
      ...process.env,
      RESTORE_ENV_FILE: ENV_FILE,
      COMPOSE_SH: FAKE_COMPOSE,
      RESTORE_TEST_LOG: COMPOSE_LOG,
      RESTORE_TEST_MODE: "true",
      RESTORE_FAIL_STAGE: stage ?? "",
      RESTORE_TEST_TARGET: target,
      RESTORE_READINESS_ATTEMPTS: "1",
      RESTORE_EXCLUDED_OBJECT_PREFIXES: "system/",
      RESTORE_TEST_APP_RUNNING: appRunning ? "true" : "false",
    },
    encoding: "utf8",
  });

const runBackup = (target: string, failure?: string, appRunning = true) =>
  spawnSync("sh", [join(DEPLOY_DIR, "backup.sh"), target], {
    cwd: REPOSITORY_ROOT,
    env: {
      ...process.env,
      BACKUP_ENV_FILE,
      BACKUP_COMPOSE_SH: FAKE_COMPOSE,
      BACKUP_TEST_MODE: "true",
      BACKUP_TEST_LOG: COMPOSE_LOG,
      RESTORE_TEST_LOG: COMPOSE_LOG,
      BACKUP_TEST_FAILURE: failure ?? "",
      BACKUP_TEST_APP_RUNNING: appRunning ? "true" : "false",
    },
    encoding: "utf8",
  });

const runConsistency = (references: string, objects: string, excluded = "") => {
  const directory = mkdtempSync(join(TEMP_ROOT, "consistency-"));
  const referencesPath = join(directory, "references.txt");
  const objectsPath = join(directory, "objects.jsonl");
  writeFileSync(referencesPath, references);
  writeFileSync(objectsPath, objects);
  const result = runPython(CONSISTENCY_SCRIPT, [
    "--references-file",
    referencesPath,
    "--objects-file",
    objectsPath,
    "--excluded-prefixes",
    excluded,
  ]);
  rmSync(directory, { recursive: true, force: true });
  return result;
};

const validProductionEnvironment = () => `NODE_ENV=production
ALLOW_TEST_CLIENT_ISOLATION=false
TRUST_PROXY_HOPS=2
FRONTEND_URL=https://cloudvault-prod.net
FRONTEND_HOST_PORT=38081
EMAIL_PROVIDER=resend
EMAIL_FROM=CloudVault <no-reply@cloudvault-prod.net>
RESEND_API_KEY=re_91f43fc72a6e4a1f
DATABASE_URL=postgresql://appuser:db-91f43fc72a6e4a1f@postgres.cloudvault-prod.net:5432/cloudvault?sslmode=verify-full
DATABASE_URL_UNPOOLED=postgresql://appuser:db-91f43fc72a6e4a1f@postgres-direct.cloudvault-prod.net:5432/cloudvault?sslmode=verify-full
JWT_ACCESS_SECRET=${randomBytes(32).toString("hex")}
JWT_REFRESH_SECRET=${randomBytes(32).toString("hex")}
REDIS_ENABLED=true
REDIS_URL=rediss://appuser:redis-91f43fc72a6e4a1f@redis.cloudvault-prod.net:6380/0
S3_ENDPOINT=https://objects.cloudvault-prod.net
S3_REGION=us-test-1
S3_BUCKET=cloudvault-production-data
S3_ACCESS_KEY_ID=accesskey91f43fc72a6e4a1f
S3_SECRET_ACCESS_KEY=storagekey91f43fc72a6e4a1f
`;

const runProductionCheck = (
  environment: string,
  nginxConfig = readFileSync(
    join(REPOSITORY_ROOT, "Frontend/deploy/docker/nginx.conf"),
    "utf8",
  ),
  fileMode = 0o600,
  composeConfig = readFileSync(PRODUCTION_COMPOSE, "utf8"),
) => {
  const suffix = randomBytes(4).toString("hex");
  const path = join(TEMP_ROOT, `production-${suffix}.env`);
  const nginxPath = join(TEMP_ROOT, `nginx-${suffix}.conf`);
  const composePath = join(TEMP_ROOT, `compose-${suffix}.yaml`);
  writeFileSync(path, environment, { mode: fileMode });
  chmodSync(path, fileMode);
  writeFileSync(nginxPath, nginxConfig);
  writeFileSync(composePath, composeConfig);
  try {
    return runPython(PRODUCTION_CHECK, [
      "--env-file",
      path,
      "--compose-file",
      composePath,
      "--nginx-config",
      nginxPath,
    ]);
  } finally {
    rmSync(path, { force: true });
    rmSync(nginxPath, { force: true });
    rmSync(composePath, { force: true });
  }
};

beforeAll(() => {
  mkdirSync(BACKUP_DIR);
  writeBackup(BACKUP_DIR);
  writeFileSync(ENV_FILE, "APP_DB_NAME=fixture\nAPP_DB_USER=fixture\nAPP_S3_BUCKET=fixture-bucket\n", {
    mode: 0o600,
  });
  writeFileSync(
    BACKUP_ENV_FILE,
    "APP_DB_NAME=fixture\nAPP_DB_USER=fixture\nAPP_S3_BUCKET=fixture-bucket\n",
    { mode: 0o600 },
  );
  writeFileSync(
    FAKE_COMPOSE,
    `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$RESTORE_TEST_LOG"
case "$1" in
  target)
    printf '%s\\n' "\${RESTORE_TEST_TARGET:-cloudvault-app-docker}"
    ;;
  ps)
  case "$*" in
    *Health*)
      printf 'postgres healthy\\nminio healthy\\napi healthy\\nworker healthy\\n'
      ;;
    *)
      printf 'postgres\\nminio\\n'
      if [ "\${RESTORE_TEST_MODE:-}" = "true" ]; then
        if [ "\${RESTORE_TEST_APP_RUNNING:-true}" = "true" ]; then
          printf 'api\\nworker\\n'
        fi
      elif [ "\${BACKUP_TEST_APP_RUNNING:-true}" = "true" ]; then
        printf 'api\\nworker\\n'
      fi
      ;;
  esac
  ;;
stop)
  exit 0
  ;;
start)
  if [ "\${BACKUP_TEST_FAILURE:-}" = "service_start" ]; then exit 41; fi
  if [ "\${RESTORE_FAIL_STAGE:-}" = "service_start" ]; then exit 41; fi
  ;;
exec)
  case "$*" in
    *pg_dump*)
      if [ "\${BACKUP_TEST_FAILURE:-}" = "database_dump" ]; then exit 42; fi
      printf 'SELECT 1;\\n'
      ;;
    *--single-transaction*)
      if [ "\${RESTORE_FAIL_STAGE:-}" = "during_database" ]; then exit 42; fi
      cat >/dev/null
        ;;
      *"/health/ready"*)
        if [ "\${RESTORE_FAIL_STAGE:-}" = "readiness" ]; then exit 43; fi
        ;;
      *deletedAt*)
        printf 'active|owner|owner/key-active|12\\nretained|owner|owner/key-retained|15\\n'
        ;;
      *)
        exit 44
        ;;
    esac
    ;;
  run)
    case "$*" in
      *"mc mirror"*)
        if [ "\${BACKUP_TEST_MODE:-}" = "true" ]; then
          if [ "\${BACKUP_TEST_FAILURE:-}" = "minio_copy" ]; then exit 45; fi
          while [ "$#" -gt 0 ]; do
            if [ "$1" = "-v" ]; then
              MOUNT_PATH=$2
              break
            fi
            shift
          done
          OBJECTS_PATH=\${MOUNT_PATH%:/backup}
          mkdir -p "$OBJECTS_PATH/owner"
          printf 'copied-object' > "$OBJECTS_PATH/owner/copied"
        elif [ "\${RESTORE_FAIL_STAGE:-}" = "minio_sync" ]; then
          exit 45
        fi
        ;;
      *"mc ls"*)
        printf '%s\\n' '{"key":"owner/key-active","size":12,"type":"file"}'
        printf '%s\\n' '{"key":"owner/key-retained","size":15,"type":"file"}'
        printf '%s\\n' '{"key":"system/metadata","size":8,"type":"file"}'
        ;;
      *)
        exit 46
        ;;
    esac
    ;;
  *)
    exit 47
    ;;
esac
`,
    { mode: 0o700 },
  );
  chmodSync(FAKE_COMPOSE, 0o700);
  writeFileSync(COMPOSE_LOG, "");
});

afterAll(() => {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
});

describe("isolated backup lifecycle", () => {
  test("creates and verifies a new backup without changing a stopped service state", () => {
    const target = join(TEMP_ROOT, "backup-success");
    writeFileSync(COMPOSE_LOG, "");
    const result = runBackup(target, undefined, false);

    expect(result.status).toBe(0);
    expect(readFileSync(COMPOSE_LOG, "utf8")).not.toContain("stop ");
    expect(readFileSync(COMPOSE_LOG, "utf8")).not.toContain("start ");
    const verified = runPython(INTEGRITY_SCRIPT, [
      "verify",
      target,
      "--expected-project",
      "cloudvault-app-docker",
      "--expected-bucket",
      "fixture-bucket",
    ]);
    expect(verified.status).toBe(0);
    expect(verified.stdout).toContain("1 object(s)");
  });

  test.each([
    ["database_dump", "PostgreSQL dump"],
    ["minio_copy", "MinIO object copy"],
  ])("removes incomplete %s backup and restores previously running services", (failure, stage) => {
    const parent = mkdtempSync(join(TEMP_ROOT, "backup-failure-"));
    const target = join(parent, "archive");
    writeFileSync(COMPOSE_LOG, "");
    const result = runBackup(target, failure, true);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(stage);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Original service state restored");
    expect(readFileSync(COMPOSE_LOG, "utf8")).toContain("start api worker");
    expect(readdirSync(parent)).toEqual([]);
    rmSync(parent, { recursive: true, force: true });
  });

  test("refuses to overwrite an existing backup destination", () => {
    const parent = mkdtempSync(join(TEMP_ROOT, "backup-existing-"));
    const target = join(parent, "archive");
    mkdirSync(target);
    writeFileSync(join(target, "keep.txt"), "preserve");
    writeFileSync(COMPOSE_LOG, "");
    const result = runBackup(target, undefined, false);

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe("preserve");
    expect(readFileSync(COMPOSE_LOG, "utf8")).toBe("");
    rmSync(parent, { recursive: true, force: true });
  });
});

describe("isolated restore failure handling", () => {
  test("recovery Compose helper names a separate recovery project", () => {
    const result = spawnSync("sh", [join(DEPLOY_DIR, "compose.recovery.sh"), "target"], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("cloudvault-app-recovery");
  });

  test.each([
    ["before_database", "before database restoration", true],
    ["during_database", "PostgreSQL transactional restore", true],
    ["after_database", "after database restoration and before MinIO synchronization", false],
    ["minio_sync", "MinIO non-destructive object synchronization", false],
    ["object_validation", "database/object-storage consistency validation", false],
    ["service_start", "API and worker startup", false],
    ["readiness", "final API readiness verification", false],
  ])("reports the %s stage and applies deterministic recovery", (stage, expectedStage, restarts) => {
    const sourceBefore = hashTree(BACKUP_DIR);
    writeFileSync(COMPOSE_LOG, "");

    const result = runRestore(stage);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(expectedStage);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("Restore completed");
    const log = readFileSync(COMPOSE_LOG, "utf8");
    if (restarts) {
      expect(`${result.stdout}\n${result.stderr}`).toContain("services were restarted");
      expect(log).toContain("start api worker");
    } else {
      expect(`${result.stdout}\n${result.stderr}`).toContain("intentionally left stopped");
      if (stage === "service_start" || stage === "readiness") {
        expect(log).toContain("start api worker");
      } else {
        expect(log).not.toContain("start api worker");
      }
    }
    expect(hashTree(BACKUP_DIR)).toBe(sourceBefore);
  });

  test("completes a matching restore without destructive MinIO deletion", () => {
    const sourceBefore = hashTree(BACKUP_DIR);
    writeFileSync(COMPOSE_LOG, "");

    const result = runRestore();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("excluded=1");
    expect(result.stdout).toContain("Restore completed");
    expect(readFileSync(COMPOSE_LOG, "utf8")).toContain("mc mirror --overwrite /backup");
    expect(readFileSync(RESTORE_SCRIPT, "utf8")).not.toContain("--remove");
    expect(hashTree(BACKUP_DIR)).toBe(sourceBefore);
  });

  test("rejects a wrong Compose deployment before stopping any service", () => {
    writeFileSync(COMPOSE_LOG, "");
    const result = runRestore(undefined, "unrelated-compose-project");
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("not the isolated recovery deployment");
    expect(readFileSync(COMPOSE_LOG, "utf8")).not.toContain("stop ");
  });

  test("refuses to restore into the source local deployment", () => {
    writeFileSync(COMPOSE_LOG, "");
    const result = runRestore(undefined, "cloudvault-app-docker");
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "not the isolated recovery deployment",
    );
    expect(readFileSync(COMPOSE_LOG, "utf8")).not.toContain("stop ");
  });

  test("reports recovery requirement when restore fails after database commit with initially stopped services", () => {
    const sourceBefore = hashTree(BACKUP_DIR);
    writeFileSync(COMPOSE_LOG, "");

    const result = runRestore("after_database", "cloudvault-app-recovery", false);

    expect(result.status).not.toBe(0);
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    expect(combinedOutput).toContain("after database restoration and before MinIO synchronization");
    expect(combinedOutput).toContain("database/object consistency is not established");
    expect(combinedOutput).toContain("follow the recovery runbook before restarting services");
    expect(combinedOutput).toContain("API and worker were not stopped by this restore");

    const log = readFileSync(COMPOSE_LOG, "utf8");
    expect(log).not.toContain("stop api");
    expect(log).not.toContain("stop worker");
    expect(log).not.toContain("start api");
    expect(log).not.toContain("start worker");
    expect(hashTree(BACKUP_DIR)).toBe(sourceBefore);
  });

  test("rejects a symlink backup directory before stopping any service", () => {
    const symlinkDir = join(TEMP_ROOT, "symlink-backup-restore");
    symlinkSync(BACKUP_DIR, symlinkDir);
    try {
      writeFileSync(COMPOSE_LOG, "");
      const result = spawnSync("sh", [RESTORE_SCRIPT, symlinkDir], {
        cwd: REPOSITORY_ROOT,
        env: {
          ...process.env,
          RESTORE_ENV_FILE: ENV_FILE,
          COMPOSE_SH: FAKE_COMPOSE,
          RESTORE_TEST_LOG: COMPOSE_LOG,
          RESTORE_TEST_MODE: "true",
          RESTORE_TEST_TARGET: "cloudvault-app-recovery",
        },
        encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("must not be a symbolic link");
      expect(readFileSync(COMPOSE_LOG, "utf8")).toBe("");
    } finally {
      rmSync(symlinkDir, { force: true });
    }
  });
});

describe("object consistency validation", () => {
  const refs = "active|owner|owner/active|5\nretained|owner|owner/old-version|3\n";
  const listing = [
    { key: "owner/active", size: 5, type: "file" },
    { key: "owner/old-version", size: 3, type: "file" },
    { key: "system/config", size: 2, type: "file" },
  ]
    .map((item) => JSON.stringify(item))
    .join("\n");

  test("classifies active, retained, and explicitly excluded objects", () => {
    const result = runConsistency(refs, listing, "system/");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("active=1, retained=1, excluded=1");
  });

  test("fails when a database-referenced object is missing", () => {
    const result = runConsistency(refs, JSON.stringify({ key: "owner/active", size: 5, type: "file" }));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("owner/old-version");
  });

  test("classifies a pending cleanup key as excluded even when its object is already absent", () => {
    const result = runConsistency(
      `${refs}excluded|owner|owner/pending-cleanup|\n`,
      listing,
      "system/",
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("excluded-missing=1");
    expect(result.stdout).toContain("Explicitly excluded database reference has no object");
  });

  test("fails and names unexpected storage objects", () => {
    const result = runConsistency(
      refs,
      `${listing}\n${JSON.stringify({ key: "orphan/untracked", size: 10, type: "file" })}`,
      "system/",
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("orphan/untracked");
  });

  test("rejects malformed or duplicate storage listings", () => {
    const malformed = runConsistency(refs, "{not-json");
    expect(malformed.status).not.toBe(0);
    const duplicate = JSON.stringify({ key: "owner/active", size: 5, type: "file" });
    const repeated = runConsistency(refs, `${duplicate}\n${duplicate}`);
    expect(repeated.status).not.toBe(0);
    expect(repeated.stderr).toContain("Duplicate object key");
  });

  test("rejects database keys outside the owner's storage prefix and mismatched sizes", () => {
    const wrongOwner = runConsistency(
      "active|other|owner/active|5\n",
      listing,
    );
    expect(wrongOwner.status).not.toBe(0);
    expect(wrongOwner.stderr).toContain("Malformed database reference");

    const wrongSize = runConsistency(
      refs,
      JSON.stringify({ key: "owner/active", size: 6, type: "file" }),
    );
    expect(wrongSize.status).not.toBe(0);
    expect(wrongSize.stderr).toContain("Database/object size mismatch: owner/active");
  });
});

describe("backup integrity and authentication", () => {
  const verify = (backup: string, env: NodeJS.ProcessEnv = {}) =>
    runPython(
      INTEGRITY_SCRIPT,
      ["verify", backup, "--expected-project", "cloudvault-app-docker", "--expected-bucket", "fixture-bucket"],
      env,
    );

  test("authenticates with a separately stored HMAC key and fails closed if required", () => {
    const authenticated = join(TEMP_ROOT, "authenticated-backup");
    mkdirSync(authenticated);
    writeBackup(authenticated);
    const manifestPath = join(authenticated, "manifest.json");
    rmSync(manifestPath);
    rmSync(join(authenticated, "objects.jsonl"));
    const keyPath = join(TEMP_ROOT, "hmac.key");
    const key = randomBytes(32);
    writeFileSync(keyPath, key, { mode: 0o600 });
    chmodSync(keyPath, 0o600);
    execFileSync(
      "python3",
      [
        INTEGRITY_SCRIPT,
        "create",
        authenticated,
        "--project",
        "cloudvault-app-docker",
        "--database-name",
        "fixture",
        "--database-user",
        "fixture",
        "--bucket",
        "fixture-bucket",
        "--timestamp",
        "fixture",
      ],
      {
        cwd: REPOSITORY_ROOT,
        env: { ...process.env, BACKUP_HMAC_KEY_FILE: keyPath },
      },
    );
    const createdManifest = readFileSync(manifestPath, "utf8");
    expect(createdManifest).not.toContain(key.toString("utf8"));
    const verified = verify(authenticated, {
      BACKUP_HMAC_KEY_FILE: keyPath,
      BACKUP_AUTH_REQUIRED: "true",
    });
    expect(verified.status).toBe(0);
    expect(verified.stdout).toContain("HMAC-SHA256 authenticated");
    expect(verify(authenticated).status).not.toBe(0);
    const wrongKeyPath = join(TEMP_ROOT, "wrong-hmac.key");
    writeFileSync(wrongKeyPath, randomBytes(32), { mode: 0o600 });
    chmodSync(wrongKeyPath, 0o600);
    expect(verify(authenticated, { BACKUP_HMAC_KEY_FILE: wrongKeyPath }).status).not.toBe(0);
  });

  test("accepts legacy checksum-only backups unless authenticated verification is required", () => {
    const legacy = join(TEMP_ROOT, "legacy-backup");
    mkdirSync(join(legacy, "objects", "owner"), { recursive: true });
    writeFileSync(join(legacy, "database.sql"), "SELECT 1;\n");
    writeFileSync(join(legacy, "objects", "owner", "old"), "old-object");
    const checksum = createHash("sha256").update(readFileSync(join(legacy, "database.sql"))).digest("hex");
    writeFileSync(
      join(legacy, "manifest.json"),
      JSON.stringify({
        manifestVersion: "1.0",
        project: "cloudvault-app-docker",
        database: { sha256: checksum },
        storage: { bucket: "fixture-bucket", directory: "objects", objectCount: 1 },
      }),
    );
    expect(verify(legacy).status).toBe(0);
    expect(verify(legacy, { BACKUP_AUTH_REQUIRED: "true" }).status).not.toBe(0);
    expect(
      verify(legacy, { BACKUP_AUTH_REQUIRED: "sometimes" }).stderr,
    ).toContain("must be a boolean");
    expect(
      runPython(INTEGRITY_SCRIPT, [
        "verify",
        legacy,
        "--expected-project",
        "cloudvault-app-docker",
        "--expected-bucket",
        "another-bucket",
      ]).status,
    ).not.toBe(0);
  });

  test("rejects duplicate, malformed, and uncounted object manifest entries", () => {
    const duplicateBackup = join(TEMP_ROOT, "duplicate-backup");
    mkdirSync(duplicateBackup);
    writeBackup(duplicateBackup);
    const manifestPath = join(duplicateBackup, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const checksumPath = join(duplicateBackup, "objects.sha256");
    const checksumLines = readFileSync(checksumPath, "utf8");
    writeFileSync(checksumPath, `${checksumLines}${checksumLines}`);
    manifest.storage.objectsManifestSha256 = createHash("sha256")
      .update(readFileSync(checksumPath))
      .digest("hex");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const duplicate = verify(duplicateBackup);
    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stderr).toContain("Duplicate object checksum entry");

    writeFileSync(checksumPath, "malformed entry\n");
    manifest.storage.objectsManifestSha256 = createHash("sha256")
      .update(readFileSync(checksumPath))
      .digest("hex");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const malformed = verify(duplicateBackup);
    expect(malformed.status).not.toBe(0);
    expect(malformed.stderr).toContain("Malformed object checksum");

    writeBackup(join(TEMP_ROOT, "count-backup"));
    const countBackup = join(TEMP_ROOT, "count-backup");
    const countManifestPath = join(countBackup, "manifest.json");
    const countManifest = JSON.parse(readFileSync(countManifestPath, "utf8"));
    countManifest.storage.objectCount = 99;
    writeFileSync(countManifestPath, JSON.stringify(countManifest));
    expect(verify(countBackup).stderr).toContain("Object count mismatch");
  });

  test("rejects duplicate JSON manifest keys", () => {
    const backup = join(TEMP_ROOT, "duplicate-json-key-backup");
    mkdirSync(backup);
    writeBackup(backup);
    const manifestPath = join(backup, "manifest.json");
    const manifest = readFileSync(manifestPath, "utf8");
    writeFileSync(manifestPath, manifest.replace('"project":', '"project":"duplicate","project":'));
    const result = verify(backup);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Duplicate manifest field: project");
  });

  test("requires v3 inventories and rejects untracked backup-root files", () => {
    const inventoryBackup = join(TEMP_ROOT, "inventory-backup");
    mkdirSync(inventoryBackup);
    writeBackup(inventoryBackup);
    rmSync(join(inventoryBackup, "objects.jsonl"));
    const missingInventory = verify(inventoryBackup);
    expect(missingInventory.status).not.toBe(0);
    expect(missingInventory.stderr).toContain("missing regular objects.jsonl");

    const extraFileBackup = join(TEMP_ROOT, "extra-file-backup");
    mkdirSync(extraFileBackup);
    writeBackup(extraFileBackup);
    writeFileSync(join(extraFileBackup, "notes.txt"), "untracked");
    const extraFile = verify(extraFileBackup);
    expect(extraFile.status).not.toBe(0);
    expect(extraFile.stderr).toContain("Unexpected backup-root entries");

    const extraDirectoryBackup = join(TEMP_ROOT, "extra-directory-backup");
    mkdirSync(extraDirectoryBackup);
    writeBackup(extraDirectoryBackup);
    mkdirSync(join(extraDirectoryBackup, "unexpected"));
    const extraDirectory = verify(extraDirectoryBackup);
    expect(extraDirectory.status).not.toBe(0);
    expect(extraDirectory.stderr).toContain("Unexpected backup-root entries");
  });

  test("requires v2 object checksums and enforces v3 inventory sizes", () => {
    const v2Backup = join(TEMP_ROOT, "v2-missing-checksums");
    mkdirSync(v2Backup);
    writeBackup(v2Backup);
    const v2ManifestPath = join(v2Backup, "manifest.json");
    const v2Manifest = JSON.parse(readFileSync(v2ManifestPath, "utf8"));
    v2Manifest.manifestVersion = "2.0";
    delete v2Manifest.storage.objectsManifestSha256;
    delete v2Manifest.storage.objectsInventoryFile;
    delete v2Manifest.storage.objectsInventorySha256;
    writeFileSync(v2ManifestPath, JSON.stringify(v2Manifest));
    rmSync(join(v2Backup, "objects.sha256"));
    rmSync(join(v2Backup, "objects.jsonl"));
    expect(verify(v2Backup).stderr).toContain("requires a missing objects.sha256 file");

    const wrongSizeBackup = join(TEMP_ROOT, "wrong-inventory-size");
    mkdirSync(wrongSizeBackup);
    writeBackup(wrongSizeBackup);
    const manifestPath = join(wrongSizeBackup, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const inventoryPath = join(wrongSizeBackup, "objects.jsonl");
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
    inventory.size += 1;
    writeFileSync(inventoryPath, `${JSON.stringify(inventory)}\n`);
    const inventoryHash = createHash("sha256")
      .update(readFileSync(inventoryPath))
      .digest("hex");
    manifest.storage.objectsInventorySha256 = inventoryHash;
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const wrongSize = verify(wrongSizeBackup);
    expect(wrongSize.status).not.toBe(0);
    expect(wrongSize.stderr).toContain("Storage object size mismatch");
  });

  test("rejects corrupted database dump with checksum mismatch", () => {
    const backup = join(TEMP_ROOT, "corrupted-db-backup");
    mkdirSync(backup);
    writeBackup(backup);
    writeFileSync(join(backup, "database.sql"), "CORRUPTED CONTENT;\n");
    const result = verify(backup);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Database SHA-256 checksum mismatch.");
  });

  test("rejects corrupted storage object content with checksum mismatch", () => {
    const backup = join(TEMP_ROOT, "corrupted-obj-backup");
    mkdirSync(backup);
    writeBackup(backup);
    writeFileSync(join(backup, "objects", "owner", "active"), "tampered-content");
    const result = verify(backup);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Storage object checksum mismatch: owner/active");
  });

  test("rejects empty database.sql and malformed manifest JSON", () => {
    const emptyDbBackup = join(TEMP_ROOT, "empty-db-backup");
    mkdirSync(emptyDbBackup);
    writeBackup(emptyDbBackup);
    writeFileSync(join(emptyDbBackup, "database.sql"), "");
    expect(verify(emptyDbBackup).stderr).toContain("database.sql is empty.");

    const malformedBackup = join(TEMP_ROOT, "malformed-manifest-backup");
    mkdirSync(malformedBackup);
    writeBackup(malformedBackup);
    writeFileSync(join(malformedBackup, "manifest.json"), "{not-json");
    expect(verify(malformedBackup).stderr).toContain("manifest.json is not valid UTF-8 JSON.");
  });

  test("rejects path traversal in object checksum paths", () => {
    const traversalBackup = join(TEMP_ROOT, "traversal-checksum-backup");
    mkdirSync(traversalBackup);
    writeBackup(traversalBackup);
    const checksumPath = join(traversalBackup, "objects.sha256");
    writeFileSync(
      checksumPath,
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  ./../escaped\n",
    );
    const manifestPath = join(traversalBackup, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.storage.objectsManifestSha256 = createHash("sha256")
      .update(readFileSync(checksumPath))
      .digest("hex");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const result = verify(traversalBackup);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unsafe object checksum path");
  });

  test("rejects symbolic links for backup root and all internal backup artifacts", () => {
    // 1. Backup root symlink
    const symlinkRoot = join(TEMP_ROOT, "symlink-root-test");
    symlinkSync(BACKUP_DIR, symlinkRoot);
    try {
      const result = verify(symlinkRoot);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Backup directory must not be a symbolic link.");
    } finally {
      rmSync(symlinkRoot, { force: true });
    }

    // 2. Manifest symlink
    const manifestSymlinkBackup = join(TEMP_ROOT, "symlink-manifest-backup");
    mkdirSync(manifestSymlinkBackup);
    writeBackup(manifestSymlinkBackup);
    const realManifest = join(TEMP_ROOT, "real_manifest.json");
    const manifestPath = join(manifestSymlinkBackup, "manifest.json");
    renameSync(manifestPath, realManifest);
    symlinkSync(realManifest, manifestPath);
    expect(verify(manifestSymlinkBackup).stderr).toContain("manifest.json must not be a symbolic link.");

    // 3. Database dump symlink
    const dbSymlinkBackup = join(TEMP_ROOT, "symlink-db-backup");
    mkdirSync(dbSymlinkBackup);
    writeBackup(dbSymlinkBackup);
    const realDb = join(TEMP_ROOT, "real_database.sql");
    const dbPath = join(dbSymlinkBackup, "database.sql");
    renameSync(dbPath, realDb);
    symlinkSync(realDb, dbPath);
    expect(verify(dbSymlinkBackup).stderr).toContain("database.sql must not be a symbolic link.");

    // 4. Objects directory symlink
    const objectsDirSymlinkBackup = join(TEMP_ROOT, "symlink-objects-dir-backup");
    mkdirSync(objectsDirSymlinkBackup);
    writeBackup(objectsDirSymlinkBackup);
    const realObjects = join(TEMP_ROOT, "real_objects");
    const objectsPath = join(objectsDirSymlinkBackup, "objects");
    renameSync(objectsPath, realObjects);
    symlinkSync(realObjects, objectsPath);
    expect(verify(objectsDirSymlinkBackup).stderr).toContain("objects directory must not be a symbolic link.");

    // 5. Individual object symlink
    const objectSymlinkBackup = join(TEMP_ROOT, "symlink-single-obj-backup");
    mkdirSync(objectSymlinkBackup);
    writeBackup(objectSymlinkBackup);
    const targetFile = join(objectSymlinkBackup, "objects", "owner", "active");
    const externalTarget = join(TEMP_ROOT, "external-object-file");
    writeFileSync(externalTarget, "external");
    rmSync(targetFile);
    symlinkSync(externalTarget, targetFile);
    expect(verify(objectSymlinkBackup).stderr).toContain("Symbolic links are not permitted in backup objects.");

    // 6. Checksum file symlink
    const checksumSymlinkBackup = join(TEMP_ROOT, "symlink-checksum-backup");
    mkdirSync(checksumSymlinkBackup);
    writeBackup(checksumSymlinkBackup);
    const realChecksum = join(TEMP_ROOT, "real_objects.sha256");
    const checksumPath = join(checksumSymlinkBackup, "objects.sha256");
    renameSync(checksumPath, realChecksum);
    symlinkSync(realChecksum, checksumPath);
    expect(verify(checksumSymlinkBackup).stderr).toContain("objects.sha256 must not be a symbolic link.");

    // 7. Inventory file symlink
    const inventorySymlinkBackup = join(TEMP_ROOT, "symlink-inventory-backup");
    mkdirSync(inventorySymlinkBackup);
    writeBackup(inventorySymlinkBackup);
    const realInventory = join(TEMP_ROOT, "real_objects.jsonl");
    const inventoryPath = join(inventorySymlinkBackup, "objects.jsonl");
    renameSync(inventoryPath, realInventory);
    symlinkSync(realInventory, inventoryPath);
    expect(verify(inventorySymlinkBackup).stderr).toContain("objects.jsonl must not be a symbolic link.");

    // 8. External HMAC key symlink
    const hmacKeySymlinkBackup = join(TEMP_ROOT, "symlink-hmac-key-backup");
    mkdirSync(hmacKeySymlinkBackup);
    writeBackup(hmacKeySymlinkBackup);
    const hmacManifestPath = join(hmacKeySymlinkBackup, "manifest.json");
    const hmacManifest = JSON.parse(readFileSync(hmacManifestPath, "utf8"));
    hmacManifest.authentication = {
      algorithm: "HMAC-SHA256",
      hmacSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    };
    writeFileSync(hmacManifestPath, JSON.stringify(hmacManifest));
    const realKey = join(TEMP_ROOT, "real-hmac.key");
    const symlinkKey = join(TEMP_ROOT, "symlink-hmac.key");
    writeFileSync(realKey, randomBytes(32), { mode: 0o600 });
    symlinkSync(realKey, symlinkKey);
    try {
      expect(verify(hmacKeySymlinkBackup, { BACKUP_HMAC_KEY_FILE: symlinkKey }).stderr).toContain(
        "The HMAC key path must not be a symbolic link.",
      );
    } finally {
      rmSync(realKey, { force: true });
      rmSync(symlinkKey, { force: true });
    }
  });
});

describe("production configuration safeguards", () => {
  test("accepts structurally valid settings while marking external services unverified", () => {
    const result = runProductionCheck(validProductionEnvironment());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("External credentials and service connectivity were not tested");
  });

  test.each([
    ["development mode", (value: string) => value.replace("NODE_ENV=production", "NODE_ENV=development")],
    ["test isolation", (value: string) => value.replace("ALLOW_TEST_CLIENT_ISOLATION=false", "ALLOW_TEST_CLIENT_ISOLATION=true")],
    ["wildcard CORS", (value: string) => value.replace("https://cloudvault-prod.net", "*")],
    ["one trusted proxy hop", (value: string) => value.replace("TRUST_PROXY_HOPS=2", "TRUST_PROXY_HOPS=1")],
    ["unencrypted database", (value: string) => value.replace("?sslmode=verify-full", "")],
    ["non-TLS Redis", (value: string) => value.replace("rediss://", "redis://")],
    ["missing S3 credentials", (value: string) => value.replace(/^S3_SECRET_ACCESS_KEY=.*\n/m, "")],
  ])("rejects unsafe production settings: %s", (_name, mutate) => {
    const result = runProductionCheck(mutate(validProductionEnvironment()));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("[FAIL]");
  });

  test("rejects Nginx configs that drop forwarded client or TLS headers", () => {
    const nginx = readFileSync(
      join(REPOSITORY_ROOT, "Frontend/deploy/docker/nginx.conf"),
      "utf8",
    );
    const result = runProductionCheck(
      validProductionEnvironment(),
      nginx.replace(
        "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
        "proxy_set_header X-Forwarded-For $remote_addr;",
      ),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("preserve the sanitized forwarded client-address chain");
  });

  test("rejects environment files readable or writable by group/other users", () => {
    const result = runProductionCheck(
      validProductionEnvironment(),
      undefined,
      0o644,
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must not be readable or writable by group/other users");
  });

  test("rejects duplicate environment variable names", () => {
    const duplicate = `${validProductionEnvironment()}NODE_ENV=production\n`;
    const result = runProductionCheck(duplicate);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid or duplicate environment name");
  });

  test("rejects malformed quoted environment values", () => {
    const malformed = validProductionEnvironment().replace(
      "NODE_ENV=production",
      'NODE_ENV="production',
    );
    const result = runProductionCheck(malformed);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Malformed quoted environment value");
  });

  test("rejects Nginx configurations that remove X-Forwarded-Proto", () => {
    const nginx = readFileSync(
      join(REPOSITORY_ROOT, "Frontend/deploy/docker/nginx.conf"),
      "utf8",
    );
    const withoutProto = nginx.replace(
      /proxy_set_header\s+X-Forwarded-Proto\s+\$forwarded_proto\s*;/g,
      "",
    );
    const result = runProductionCheck(validProductionEnvironment(), withoutProto);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Frontend Nginx must preserve the trusted external TLS protocol");
  });

  test("rejects Nginx configurations that remove the safe forwarded-protocol fallback map", () => {
    const nginx = readFileSync(
      join(REPOSITORY_ROOT, "Frontend/deploy/docker/nginx.conf"),
      "utf8",
    );
    const withoutMap = nginx.replace(
      /map\s+\$http_x_forwarded_proto\s+\$forwarded_proto\s*\{[\s\S]*?\}/,
      "",
    );
    const result = runProductionCheck(validProductionEnvironment(), withoutMap);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Frontend Nginx must define a safe forwarded-protocol fallback");
  });

  test("rejects Compose configurations that include local database or storage services", () => {
    const compose = readFileSync(PRODUCTION_COMPOSE, "utf8");
    const withPostgres = compose.replace(
      "services:\n",
      "services:\n  postgres:\n    image: postgres:16\n",
    );
    const result = runProductionCheck(
      validProductionEnvironment(),
      undefined,
      undefined,
      withPostgres,
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "must not run local PostgreSQL, Redis, or MinIO services",
    );
  });

  test("rejects Compose configurations missing API or worker services", () => {
    const compose = readFileSync(PRODUCTION_COMPOSE, "utf8");
    const withoutWorker = compose.replace(
      /worker:\n[\s\S]*?(?=frontend:)/,
      "",
    );
    const result = runProductionCheck(
      validProductionEnvironment(),
      undefined,
      undefined,
      withoutWorker,
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "must define both API and worker services",
    );
  });

  test("rejects Compose configurations publishing host ports on internal services", () => {
    const compose = readFileSync(PRODUCTION_COMPOSE, "utf8");
    const withApiPorts = compose.replace(
      "  api:\n",
      "  api:\n    ports:\n      - \"8000:8000\"\n",
    );
    const result = runProductionCheck(
      validProductionEnvironment(),
      undefined,
      undefined,
      withApiPorts,
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must not publish host ports");
  });

  test("rejects Compose configurations that publish frontend on non-loopback addresses", () => {
    const compose = readFileSync(PRODUCTION_COMPOSE, "utf8");
    const publicFrontend = compose.replace(
      "127.0.0.1:${FRONTEND_HOST_PORT:",
      "0.0.0.0:${FRONTEND_HOST_PORT:",
    );
    const result = runProductionCheck(
      validProductionEnvironment(),
      undefined,
      undefined,
      publicFrontend,
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Only the frontend may be published, and it must bind to loopback");
  });

  test("rejects a symbolic link pointing to an otherwise valid mode-0600 environment file", () => {
    const suffix = randomBytes(4).toString("hex");
    const targetPath = join(TEMP_ROOT, `target-${suffix}.env`);
    const linkPath = join(TEMP_ROOT, `link-${suffix}.env`);
    const nginxPath = join(TEMP_ROOT, `nginx-${suffix}.conf`);
    const composePath = join(TEMP_ROOT, `compose-${suffix}.yaml`);
    writeFileSync(targetPath, validProductionEnvironment(), { mode: 0o600 });
    chmodSync(targetPath, 0o600);
    symlinkSync(targetPath, linkPath);
    writeFileSync(
      nginxPath,
      readFileSync(join(REPOSITORY_ROOT, "Frontend/deploy/docker/nginx.conf"), "utf8"),
    );
    writeFileSync(composePath, readFileSync(PRODUCTION_COMPOSE, "utf8"));
    try {
      const result = runPython(PRODUCTION_CHECK, [
        "--env-file",
        linkPath,
        "--compose-file",
        composePath,
        "--nginx-config",
        nginxPath,
      ]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Production environment file must not be a symbolic link");
    } finally {
      rmSync(linkPath, { force: true });
      rmSync(targetPath, { force: true });
      rmSync(nginxPath, { force: true });
      rmSync(composePath, { force: true });
    }
  });

  test.each([
    [
      "identical JWT access and refresh secrets",
      (env: string) => {
        const secret = "a".repeat(40);
        return env
          .replace(/JWT_ACCESS_SECRET=.*\n/, `JWT_ACCESS_SECRET=${secret}\n`)
          .replace(/JWT_REFRESH_SECRET=.*\n/, `JWT_REFRESH_SECRET=${secret}\n`);
      },
      "JWT secrets must be distinct and contain at least 32 characters each",
    ],
    [
      "short JWT secret under 32 characters",
      (env: string) => env.replace(/JWT_ACCESS_SECRET=.*\n/, "JWT_ACCESS_SECRET=short_secret\n"),
      "JWT secrets must be distinct and contain at least 32 characters each",
    ],
    [
      "missing mandatory production setting",
      (env: string) => env.replace(/DATABASE_URL=.*\n/, ""),
      "Missing mandatory production setting: DATABASE_URL",
    ],
    [
      "local Redis host in production URL",
      (env: string) =>
        env.replace(
          /REDIS_URL=.*\n/,
          "REDIS_URL=rediss://appuser:secure-password@127.0.0.1:6380/0\n",
        ),
      "REDIS_URL must use TLS, authentication, and a non-local production endpoint",
    ],
    [
      "non-TLS S3 endpoint",
      (env: string) =>
        env.replace(
          /S3_ENDPOINT=.*\n/,
          "S3_ENDPOINT=http://objects.cloudvault-prod.net\n",
        ),
      "S3_ENDPOINT must use HTTPS and a non-local production endpoint",
    ],
  ])("rejects invalid security configuration: %s", (_name, mutate, expectedError) => {
    const result = runProductionCheck(mutate(validProductionEnvironment()));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(expectedError);
  });
});
