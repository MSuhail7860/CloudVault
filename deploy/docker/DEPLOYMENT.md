# Isolated Docker deployment

This Compose project is a local, isolated deployment. It creates its own PostgreSQL, Redis, and MinIO services, named volumes, and Docker networks. It does not use the development database or the integration-test containers. The checked-in files contain no working credentials.

## First startup

From the repository root:

```sh
./deploy/docker/setup.sh
./deploy/docker/up.sh
```

`setup.sh` creates `deploy/docker/.env` with separate random credentials and creates a private local mail-capture directory. It does not overwrite an existing environment file. Keep that file and the volumes together; changing MinIO or database passwords while retaining their data volumes requires an explicit credential rotation.

Compose applies pending Prisma migrations using `prisma migrate deploy` in a one-shot service before starting the API and worker. It never uses `migrate reset`, `db push`, or development migrations.
The worker readiness check uses a loopback-only health endpoint that reports ready only after all three BullMQ workers connect, recurring jobs are scheduled, and startup recovery completes; a Redis ping alone is not treated as worker readiness.

Open the application at <http://localhost:38080>. The MinIO console is bound to the local machine at <http://localhost:39001>; do not expose it on an untrusted network. PostgreSQL, Redis, and the MinIO S3 endpoint are not published to host ports.

The API trusts exactly one proxy hop for client IP and rate-limit handling. Keep this value aligned with the number of trusted reverse proxies in front of the API if the topology changes.

For local email verification, registration messages are captured under `deploy/docker/mail-capture/`. Treat those files as sensitive because they contain single-use verification links. They are ignored by Git.

## Browser tests against the Docker deployment

Install the frontend dependencies and Playwright's Chromium browser using the existing frontend setup. Start the Docker project, then run:

```sh
cd Frontend
PLAYWRIGHT_BASE_URL=http://localhost:38080 \
E2E_API_BASE_URL=http://localhost:38080/api/v1 \
E2E_MAIL_CAPTURE_DIRECTORY=../deploy/docker/mail-capture \
npm run test:e2e
```

The browser suite uses fresh test accounts, local captured email, and the Dockerized API, PostgreSQL, Redis, and MinIO. The app streams file downloads through its authenticated API; it does not issue browser-facing S3 presigned URLs.

Automated E2E tests isolate rate-limiting buckets per test client identity using `x-test-client-id` when `ALLOW_TEST_CLIENT_ISOLATION=true` in non-production environments. Repeated test executions run reliably without needing to restart the API. In production (`NODE_ENV=production`), test client isolation is strictly rejected and rate limiting is always enforced per remote IP.

## Backup and recovery

Backups are created from the local `cloudvault-app-docker` project. Restore is restricted to the separate `cloudvault-app-recovery` project; it never restores into the source local project. The recovery project has its own database, Redis, MinIO volumes, networks, loopback-only ports, and mail-capture directory. PostgreSQL and MinIO are not atomic as a pair: the database is restored in one transaction, then objects are copied and checked. A failed operation after database commit leaves previously running API/worker services stopped.

### Create and verify a backup

```sh
./deploy/docker/backup.sh
./deploy/docker/verify-backup.sh deploy/docker/backups/backup-YYYYMMDD_HHMMSSZ
```

`backup.sh` quiesces only API/worker services that were running when the backup started. It never replaces an existing destination and preserves its source services' original running state. It writes into a private staging directory, copies PostgreSQL and MinIO data, generates SHA-256 checksums, verifies the completed backup, and then renames the staging directory into a new destination. A failure removes only that script's staging directory. A local backup is not an off-site disaster-recovery copy.

```sh
# Optional authenticated manifests: create a separate random key using your
# approved secret manager, store it outside backups with mode 0600, and set:
export BACKUP_HMAC_KEY_FILE=/secure/path/cloudvault-backup-hmac.key
./deploy/docker/backup.sh deploy/docker/backups/authenticated-backup
BACKUP_AUTH_REQUIRED=true ./deploy/docker/verify-backup.sh deploy/docker/backups/authenticated-backup
```

SHA-256 detects accidental corruption but does not authenticate a backup: an attacker able to change a backup can also replace its hashes. HMAC-SHA256 authenticates the manifest only when `BACKUP_HMAC_KEY_FILE` points to a separately managed key of at least 32 bytes. The key must be stored outside the backup, inaccessible to group/other users, backed up through an approved key-recovery process, and never written into the archive. Existing checksum-only/legacy backups remain verifiable unless `BACKUP_AUTH_REQUIRED=true`; authenticated backups always require their external key. Do not waive authentication requirements for a production recovery without an explicit risk decision.

### Recovery runbook

1. **Identify and verify the source backup.** Keep the selected backup unchanged. Run `./deploy/docker/verify-backup.sh <backup-directory>` before starting recovery. If authentication is required, set `BACKUP_AUTH_REQUIRED=true` and provide the separately stored `BACKUP_HMAC_KEY_FILE`. A checksum-only or legacy backup is not tamper-authenticated. If a required HMAC or encryption key is unavailable, stop.
2. **Prepare the isolated target.** Run `./deploy/docker/setup-recovery.sh`; it creates `.env.recovery` with separate random credentials and recovery-only named volumes, networks, loopback ports, and mail capture. It never overwrites an existing file. Confirm `./deploy/docker/compose.recovery.sh target` prints `cloudvault-app-recovery`. Do not repoint the recovery helper at another env file, volume, network, or project.
3. **Start only the recovery project.** Run `./deploy/docker/compose.recovery.sh up --detach --wait` and inspect its services with `./deploy/docker/compose.recovery.sh ps`. The local source project is not stopped or modified. Recovery frontend and MinIO console use loopback ports 38081 and 39002 by default. Confirm the recovered bucket name in the backup matches `APP_S3_BUCKET` in `.env.recovery`; the target MinIO instance is separate even when the bucket name is the same.
4. **Restore into the isolated target.** Run `./deploy/docker/restore.sh <backup-directory>`. The script requires the dedicated recovery Compose helper and `.env.recovery`, verifies the source project/bucket metadata, stops only recovery API/worker services that were running, restores PostgreSQL transactionally, and non-destructively copies the backup objects.
5. **Review validation and failures.** Before database commit, SQL failure rolls back. After database commit, an object sync, size, owner-prefix, reference, service, or readiness failure is reported by stage and leaves previously running recovery API/worker services stopped. Preserve the source backup and recovery target state; do not promote or redirect the target. Resolve failures only through an operator-reviewed recovery procedure.
6. **Check the recovered application.** On successful restore, inspect `./deploy/docker/compose.recovery.sh ps` and logs. The script compares database active and retained file/version references, owner prefixes, and byte sizes against relative MinIO object keys. Missing references, size mismatches, and unexpected objects fail validation. It does not delete extra objects (`mc mirror --remove` is never used).
7. **Keep promotion explicit.** This workflow does not promote, redirect traffic to, or overwrite production. Any promotion requires a separate owner/operator-controlled plan, fresh safety checks, and infrastructure-specific validation. A successful isolated restore is not proof of production readiness or a live disaster-recovery drill.

The script's failure-injection tests use a temporary backup and a fake Compose command only; they do not contact Docker, PostgreSQL, or MinIO. PostgreSQL rollback is transactional, but the combined PostgreSQL-plus-MinIO restoration is not atomic. A power loss or process failure between database commit and object sync can leave a partial isolated restore; use the stage report and operator-reviewed recovery procedure.

## Subsequent startup and shutdown

```sh
./deploy/docker/compose.sh up --detach --wait
./deploy/docker/compose.sh ps
./deploy/docker/compose.sh logs --follow api worker
./deploy/docker/compose.sh stop
```

`stop` preserves every container and named volume. Starting again with `up` retains application data. Do not use `down --volumes` unless you deliberately intend to destroy this isolated application data.

To run migrations explicitly after a build or schema update:

```sh
./deploy/docker/compose.sh run --rm migrate
```

The Compose project publishes only the frontend on `127.0.0.1:38080` and the MinIO console on `127.0.0.1:39001` by default. Change these host ports in the ignored `.env` only after checking for conflicts.

## Local and production deployment configurations

`deploy/docker/compose.yaml` is explicitly **local/testing only**. It uses `NODE_ENV=development`, test-client isolation, local MinIO, and local email capture. Its frontend and MinIO console host ports bind to loopback; database, Redis, and object storage have no host ports. Do not expose this project publicly. `deploy/docker/.env.example` is placeholder documentation only; `setup.sh` generates local-only credentials and never overwrites an existing `.env`.

The separate `deploy/docker/compose.production.yaml` defines API, worker, migration, and frontend services only; PostgreSQL, Redis, S3-compatible storage, email delivery, secret injection, and TLS termination are external responsibilities. It forces `NODE_ENV=production`, disables test-client isolation, requires Resend configuration, and publishes only the frontend on `127.0.0.1:${FRONTEND_HOST_PORT}` for an external TLS reverse proxy. The API, worker, and migration service have no host ports. The frontend proxy and API share a private Compose network; the network still has outbound access for managed dependencies. `TRUST_PROXY_HOPS` must count the complete chain to the API, including frontend Nginx and each upstream proxy. The external edge must overwrite, not trust or append to, client-supplied `X-Forwarded-For` and `X-Forwarded-Proto` headers. The validator requires at least two hops and checks that Nginx preserves that sanitized chain.

### Database Connection Strings & Migration Architecture

CloudVault enforces a strict architectural separation between runtime connection pooling and migration execution:

- **Runtime Connection (`DATABASE_URL`):** The pooled PostgreSQL URL (typically provided via PgBouncer or managed provider poolers like Neon Pooled). Inherited by the `api` and `worker` containers for normal transactional application traffic.
- **Migration Connection (`DATABASE_URL_UNPOOLED`):** The direct, unpooled PostgreSQL URL. Strictly required by the one-shot `migrate` service. Prisma Migrate requires direct database connections to acquire advisory locks, execute schema DDL alterations, and maintain session pinning across migrations without pooler interruptions.
- **Fail-Closed Guarantee:** The migration service defines `DATABASE_URL: "${DATABASE_URL_UNPOOLED:?DATABASE_URL_UNPOOLED is required for migrations}"`. If `DATABASE_URL_UNPOOLED` is missing or empty, Docker Compose interpolation immediately halts with an error. The migration service **never falls back** to the pooled URL.

> ⚠️ **CRITICAL WARNING:** Never execute production database migrations or deploy the production Compose stack until external infrastructure (PostgreSQL, Redis, S3, Resend, and TLS edge) has been fully provisioned, secured, and validated.

### Production Preflight & Deployment Sequence

1. **Storage Versioning Preflight:**
   Verify that S3 bucket versioning is disabled on the production bucket:
   ```sh
   npm --prefix Backend run storage:preflight
   ```

2. **Environment File Preparation:**
   Prepare an ignored `deploy/docker/.env.production` file with mode `0600` via your secure secret injection mechanism. `.env.production.example` contains placeholder tokens and is not deployable:
   ```sh
   chmod 600 deploy/docker/.env.production
   ```

3. **Production Configuration Validation:**
   Run the fail-closed Python configuration validator:
   ```sh
   python3 deploy/docker/production-config-check.py --env-file deploy/docker/.env.production
   ```
   The validator enforces:
   - `NODE_ENV=production` and `ALLOW_TEST_CLIENT_ISOLATION=false`.
   - Mandatory presence of `DATABASE_URL_UNPOOLED` with valid PostgreSQL URI, non-local host, non-placeholder credentials, and TLS (`sslmode=require|verify-ca|verify-full`).
   - Valid pooled `DATABASE_URL` targeting production PostgreSQL with TLS.
   - Secure `REDIS_URL` with `rediss://` TLS and non-placeholder authentication.
   - HTTPS `S3_ENDPOINT` and distinct 32+ character JWT secrets.
   - Compose file verification ensuring `migrate` requires `DATABASE_URL_UNPOOLED` without fallback.

4. **Rendered Compose Verification:**
   Verify the interpolated Compose configuration without launching containers:
   ```sh
   ./deploy/docker/compose.production.sh config --quiet
   ```

5. **Deploy Services:**
   Launch the verified production stack:
   ```sh
   ./deploy/docker/compose.production.sh up --detach --build --wait
   ```

6. **Post-Deployment Smoke-Test:**
   Execute the step-by-step non-destructive smoke-test procedure documented in [PRODUCTION_SMOKE_TEST.md](PRODUCTION_SMOKE_TEST.md).

The validator rejects development mode, enabled test isolation, missing/placeholder secrets, short/equal JWT secrets, wildcard or non-HTTPS CORS origins, local/non-TLS database or Redis endpoints, non-HTTPS S3 endpoints, missing Resend/storage configuration, and non-loopback or internal-service host port exposure. It validates configuration structure and values only; it does not prove credentials work, check provider account status, or establish TLS/network reachability. Put TLS termination and the public hostname at a separately managed edge proxy and forward only to the loopback frontend port. No production secrets belong in Compose, Dockerfiles, source control, or this example file.

## Operational and disaster-recovery requirements

Before public operation, provision and independently test:

* Production PostgreSQL with TLS, encrypted storage, monitored backups, and tested restore.
* TLS-enabled managed Redis with authentication, persistence, `noeviction`, and queue monitoring.
* Production S3-compatible storage with HTTPS, least-privilege access, lifecycle/retention policy, and documented versioning/deletion semantics.
* Verified Resend account and sender-domain DNS (SPF, DKIM, and DMARC).
* Domain, HTTPS/TLS termination, secure reverse-proxy trust configuration, network controls, and secret-manager injection.
* Encrypted backups in a separately administered off-site location, retention/rotation policy, HMAC/encryption key recovery, access controls, monitoring, and alerting.
* Periodic restoration drills, application-level verification, and incident ownership/runbooks.

The local backup scripts do not encrypt archives, upload off-site, rotate or expire old backups, configure managed-service retention, or provide monitoring/alerting. Use independently managed encryption at rest and in transit, off-site copies, strict access controls, and recovery-key escrow. A successful local restore is not evidence of production readiness or disaster-recovery readiness. No managed PostgreSQL, managed Redis, production S3, real email delivery, public TLS, secret manager, encrypted off-site backup, monitoring, or alerting integration is configured or tested by this repository workflow.
