# ☁️ CloudVault

A production-grade, secure cloud file storage and collaboration platform for organizing, managing, sharing, and versioning files. Built with S3-compatible object storage, PostgreSQL, Prisma ORM, JWT authentication, and asynchronous background job queues.

> **Project Status:** 🚧 In Development (Core Engineering & Local Verification Complete)
>
> *All application features, background job processing, security hardening, database schema migrations, and isolated verification suites (375 unit tests, 24 integration tests, Playwright browser E2E, and production configuration validators) are fully implemented and verified locally. Live public operation remains pending deployment to dedicated, customer-managed external production infrastructure (managed PostgreSQL with TLS, Redis cluster with TLS, S3-compatible storage with IAM policies, Resend DNS verification, edge TLS reverse proxy, and off-site backup storage).*

---

## ✨ Key Features

- 🔐 **Authentication & Account Lifecycle** — Email/password registration with email verification, bcrypt hashing, short-lived JWT access tokens via `jose`, transactional refresh token rotation, session epoch invalidation, password updates, and hardened asynchronous account deletion with orphaned object reclamation.
- 📁 **File & Folder Management** — Direct-to-storage admission control, streaming download with range support, file ownership authorization, folder hierarchies, search and MIME/type filtering, soft deletion (trash), version-aware restoration, and atomic permanent deletion.
- 🕐 **Application-Level File Versioning** — Explicit version creation, history tracking, version restoration, and historical version downloads using immutable storage keys (`${userId}/${fileId}-v${versionNumber}-${hash}`).
- 🤝 **Sharing & Collaboration** — Granular direct user sharing (`VIEW` / `EDIT` permissions) and public/expiring share links with optional password protection, recipient email normalization, and revocation.
- 📝 **Activity Auditing** — Fine-grained audit log recording all file uploads, modifications, shares, permissions changes, and deletions.
- ⚙️ **Background Processing & Reliability** — BullMQ queues with Redis for asynchronous metadata extraction, scheduled maintenance cleanup, and staged account deletion with inline fallback, lease renewal, and operator escalation for stalled jobs.
- 🛡️ **Production Security & Hardening** — End-to-end request ID correlation (`X-Request-ID`), structured JSON error logging, Helmet security headers, rate limiting on authentication routes, strict CORS origin controls, and path traversal prevention.
- 💾 **Disaster Recovery & Backup Integrity** — Transactional database and MinIO storage backup scripts (`backup.sh`), SHA-256 checksums, v3 inventories, HMAC-SHA256 external authentication keys, and failure-resilient restoration (`restore.sh`) with rollback protection.
- 📊 **Health Monitoring** — HTTP readiness probes (`/health/ready`) on API (port 8000) and background worker (port 8001), alongside Prometheus alerting rules (`prometheus-alerts.yaml`).

---

## 🛠️ Technology Stack

| Tier | Technologies |
|---|---|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS 4, React Router, TanStack Query, Axios, Lucide React |
| **Backend** | Node.js 24, Express 5, TypeScript (strict ESM), Prisma 7, `jose` (JWT), bcrypt |
| **Database & Cache** | PostgreSQL (Neon or self-hosted), Redis 7 |
| **Object Storage** | AWS S3 or MinIO (S3-compatible, private bucket) |
| **Job Queue** | BullMQ |
| **Deployment** | Docker Compose, Multi-stage Dockerfiles, Nginx edge proxy, read-only root filesystems |
| **Testing** | Vitest (375 unit tests across 25 suites), Integration suite (24 tests), Playwright (browser E2E) |

---

## 🏗️ Architecture

```text
                           ┌─────────────────────────┐
                           │   React 19 / Vite SPA   │
                           │   (Nginx Edge Proxy)    │
                           └────────────┬────────────┘
                                        │
                            REST API / HTTPS / Bearer JWT
                                        │
                           ┌────────────▼────────────┐
                           │   Express 5 API Server  │
                           │      (Port 8000)        │
                           └──────┬────────────┬─────┘
                                  │            │
            ┌─────────────────────┘            └─────────────────────┐
            │                                                        │
    ┌───────▼────────┐                                       ┌───────▼────────┐
    │   PostgreSQL   │                                       │   S3 / MinIO   │
    │   (Prisma 7)   │                                       │  Object Store  │
    ├────────────────┤                                       ├────────────────┤
    │ Users          │                                       │ Private Bucket │
    │ Files          │                                       │ Application    │
    │ Folders        │                                       │ Versioned Keys │
    │ Shares         │                                       └────────────────┘
    │ Activities     │                                               ▲
    │ Deletion Tasks │                                               │
    └────────────────┘                                               │
            │                                                        │
    ┌───────▼────────┐                                               │
    │     Redis      │                                               │
    │ BullMQ Queues  │                                               │
    └───────┬────────┘                                               │
            │                                                        │
    ┌───────▼────────┐                                               │
    │ BullMQ Worker  ├───────────────────────────────────────────────┘
    │ Health (:8001) │ (Async metadata, cleanup, account deletion)
    └────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 24+ and npm 10+
- Docker and Docker Compose
- PostgreSQL 16+ (or local Docker container)
- Redis 7+ (or local Docker container)
- MinIO or AWS S3 credentials

### 1. Repository Setup

```bash
git clone https://github.com/MSuhail7860/CloudVault.git
cd CloudVault
```

Install backend and frontend dependencies:

```bash
# Backend dependencies
npm --prefix Backend install

# Frontend dependencies
npm --prefix Frontend install
```

### 2. Local Development Environment

Copy the example environment configurations:

```bash
cp Backend/.env.example Backend/.env
cp Frontend/.env.example Frontend/.env
```

Configure `Backend/.env` with local credentials:

```env
PORT=8000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cloudvault
JWT_ACCESS_SECRET=your-minimum-32-character-access-secret
JWT_REFRESH_SECRET=your-minimum-32-character-refresh-secret
REDIS_ENABLED=true
REDIS_URL=redis://localhost:6379
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=cloudvault-files
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
FRONTEND_URL=http://localhost:3000
```

Start the local Docker Compose development services (PostgreSQL, Redis, MinIO):

```bash
cd deploy/docker
docker compose up -d postgres redis minio
```

Run Prisma migrations:

```bash
npx --prefix Backend prisma migrate dev
```

Start the backend API, worker, and frontend dev servers:

```bash
# Terminal 1 - Backend API
npm --prefix Backend run dev

# Terminal 2 - Background Worker
npm --prefix Backend run worker

# Terminal 3 - Frontend SPA
npm --prefix Frontend run dev
```

The application is available at:
- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8000`
- API Readiness Probe: `http://localhost:8000/health/ready`
- Worker Readiness Probe: `http://localhost:8001/health/ready`

---

## 🔒 Storage Architecture & Bucket Versioning Rule

CloudVault manages file versioning **at the application layer** by persisting distinct, immutable object keys for each version:

```text
${userId}/${fileId}-v${versionNumber}-${contentHash}
```

> ⚠️ **CRITICAL INVARIANT:** S3 bucket-level versioning **MUST BE DISABLED** on the underlying S3/MinIO bucket.
>
> When S3 bucket versioning is enabled, calling `DeleteObject` places an S3 Delete Marker instead of deleting the object bytes. This prevents permanent file deletion, leaves historical objects orphaned after account deletion, and breaks physical cleanup guarantees.
>
> Run the storage versioning preflight check before deploying:
> ```bash
> npm --prefix Backend run storage:preflight
> ```
> The preflight connects to S3 and verifies that `GetBucketVersioning` returns neither `Enabled` nor `Suspended`.

---

## 🧪 Testing Suite

CloudVault includes comprehensive test suites across unit, integration, browser end-to-end, and production configuration layers.

### 1. Backend Unit Tests (Vitest)

Runs 375 isolated unit tests across 25 test suites covering controllers, services, middleware, queues, workers, and restore failure handling:

```bash
npm --prefix Backend test
```

### 2. Backend Integration Tests

Runs 24 integration tests against dedicated local integration containers: PostgreSQL (`:55432`), Redis (`:56379`), and MinIO (`:59000`):

```bash
npm --prefix Backend run test:integration
```

### 3. End-to-End Browser Tests (Playwright)

Runs headless browser tests validating registration, email verification, login, file lifecycle, versioning, sharing, and account deletion:

```bash
npm --prefix Backend run test:e2e
```

### 4. Production Configuration Validator Tests

Runs 17 focused security and topology test cases against the production configuration validator:

```bash
python3 deploy/docker/test-production-config.py
```

### 5. Builds & Linting

```bash
# Backend TypeScript compilation
npm --prefix Backend run build

# Frontend production build
npm --prefix Frontend run build

# Frontend ESLint verification
npm --prefix Frontend run lint
```

---

## 🚢 Production Deployment

The production stack is containerized in `deploy/docker/compose.production.yaml` with comprehensive security hardening:

- **Edge Tier:** Nginx reverse proxy serving static frontend assets and routing `/api/v1` traffic.
- **Backend Tier:** Read-only root filesystem with `tmpfs`, dropped privileges (`no-new-privileges:true`), and health checks.
- **Worker Tier:** Internal background worker listening on `:8001/health/ready` for internal Docker health checks, completely unexposed to the host.
- **Migration Tier:** One-shot `migrate` service that runs `prisma migrate deploy` before API and worker startup.

### Database Connection Separation & Fail-Closed Migrations

CloudVault enforces an intentional architectural separation between connection-pooled application traffic and direct migration execution:

- **Runtime Connections (`DATABASE_URL`):** Pooled PostgreSQL connection string used by the `api` and `worker` services for standard application traffic.
- **Migration Connection (`DATABASE_URL_UNPOOLED`):** Direct, unpooled PostgreSQL connection string strictly required by the `migrate` service. Prisma Migrate requires unpooled direct connections to acquire PostgreSQL advisory locks, execute DDL schema modifications, and avoid connection pooler transaction disruptions.
- **Fail-Closed Guarantee:** The migration service in `compose.production.yaml` enforces:
  ```yaml
  DATABASE_URL: "${DATABASE_URL_UNPOOLED:?DATABASE_URL_UNPOOLED is required for migrations}"
  ```
  If `DATABASE_URL_UNPOOLED` is missing or empty, Compose fails immediately. It will **never** silently fall back to the pooled connection string.

### Preflight Configuration Validation

Validate your production environment configuration before deployment:

```bash
python3 deploy/docker/production-config-check.py --env-file deploy/docker/.env.production
```

> ⚠️ **IMPORTANT:** Never execute production database migrations or deploy the production Compose stack until external infrastructure (PostgreSQL, Redis, S3, Resend, and TLS edge) has been fully provisioned and validated.

---

## 💾 Backup and Disaster Recovery

CloudVault includes hardened backup and recovery tooling in `deploy/docker/`:

- **Backup Creation (`backup.sh`):**
  Exports consistent PostgreSQL dumps (`database.sql`), MinIO object storage files (`objects/`), v3 object inventories (`manifest.json`), and SHA-256 checksums with optional HMAC-SHA256 authentication (`manifest.hmac`).
  ```bash
  export BACKUP_HMAC_KEY_FILE=/path/to/cloudvault-backup-hmac.key  # Optional HMAC key
  ./deploy/docker/backup.sh deploy/docker/backups/my-backup
  ```

- **Backup Verification (`verify-backup.sh`):**
  Verifies inventory completeness, manifest checksums, path traversal safety, and HMAC signatures.
  ```bash
  export BACKUP_HMAC_KEY_FILE=/path/to/cloudvault-backup-hmac.key
  ./deploy/docker/verify-backup.sh deploy/docker/backups/my-backup
  ```

- **Restoration (`restore.sh`):**
  Restores PostgreSQL and MinIO atomically with pre-restoration snapshots, stage-by-stage verification, and automatic rollback upon partial failure into an isolated recovery environment:
  ```bash
  export BACKUP_HMAC_KEY_FILE=/path/to/cloudvault-backup-hmac.key
  ./deploy/docker/restore.sh deploy/docker/backups/my-backup
  ```

---

## 📡 Monitoring & Alerting

`deploy/docker/prometheus-alerts.yaml` defines production alerts:
- `CloudVaultApiUnhealthy`: Fires when `http://api:8000/health/ready` probe fails (> 1 min).
- `CloudVaultWorkerUnhealthy`: Fires when `http://worker:8001/health/ready` probe fails (> 2 min).
- `CloudVaultApiHighErrorRate`: Fires when HTTP 5xx error rate exceeds 5% over 5 minutes.
- `CloudVaultAccountDeletionEscalated`: Alerts operators when an asynchronous deletion task exceeds retry limits.
- `CloudVaultDatabaseConnectionExhaustion`: Alerts when PostgreSQL connection pool usage exceeds 80%.
- `CloudVaultRedisDown`: Alerts when Redis is unreachable.
- `CloudVaultBackupMissingOrStale`: Alerts when no valid backup has completed within 26 hours.

---

## 🛡️ Production Readiness & External Infrastructure Requirements

While the application codebase, container images, and local test suites have been verified, public production readiness requires provisioning the following external infrastructure components:

1. **Managed PostgreSQL (e.g. Neon, AWS RDS, Supabase):** PostgreSQL 16+ with TLS (`sslmode=verify-full`), automated point-in-time recovery, connection pooler (for `DATABASE_URL`), and direct unpooled endpoint (for `DATABASE_URL_UNPOOLED`).
2. **Managed Redis (e.g. Upstash, AWS ElastiCache):** Redis 7+ with TLS (`rediss://`), authentication token, memory eviction policy set to `noeviction`, and persistence enabled.
3. **S3-Compatible Object Storage (e.g. AWS S3, Cloudflare R2):** Private bucket with HTTPS endpoint, least-privilege IAM credentials, and **bucket versioning explicitly disabled** (required for application-level versioning and clean physical deletion).
4. **Email Delivery (Resend):** Verified sending domain with configured SPF, DKIM, and DMARC DNS records.
5. **Edge TLS & Reverse Proxy (e.g. Cloudflare, AWS ALB, Nginx):** Valid TLS certificates, HTTP/2 or HTTP/3, and forwarding to the loopback frontend host port (`127.0.0.1:${FRONTEND_HOST_PORT}`).
6. **Secret Management:** Production secrets injected securely into `deploy/docker/.env.production` (permissions `0600`) via HashiCorp Vault, AWS Secrets Manager, or Doppler.
7. **Off-Site Backups:** Replicating verified backup directories to an independent, encrypted cloud storage bucket with strict access separation.

---

## 📄 License

This project is intended for educational, portfolio, and production reference purposes.
