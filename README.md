# ☁️ CloudVault

CloudVault is a cloud file storage and collaboration platform for securely uploading, organizing, sharing, and versioning files.

Built with React, Node.js, PostgreSQL, Redis, and S3-compatible object storage.

## ✨ Features

- **Authentication:** Email verification, JWT access and refresh tokens, session revocation, and secure password hashing.
- **File Management:** Uploads, downloads, folder organization, search, trash, and file restoration.
- **File Versioning:** Version history, restoration, and immutable storage keys.
- **Sharing & Collaboration:** Direct user sharing with `VIEW` and `EDIT` permissions, plus expiring and password-protected public links.
- **Activity Logging:** Records important file and sharing activities.
- **Background Jobs:** BullMQ workers for metadata processing, cleanup, and account deletion.
- **Security:** Request ID tracking, structured logging, rate limiting, CORS controls, and path traversal protection.
- **Backup & Recovery:** Database and object storage backups, integrity verification, and recovery tooling.
- **Monitoring:** API and worker readiness endpoints with Prometheus alert rules.

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4 |
| Backend | Node.js 24, Express 5, TypeScript |
| ORM | Prisma 7 |
| Database | PostgreSQL |
| Cache & Queues | Redis 7, BullMQ |
| Authentication | JWT (`jose`), bcrypt |
| Object Storage | AWS S3 / MinIO |
| Deployment | Docker Compose, Nginx |
| Testing | Vitest, Playwright |

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

## 🏗️ Project Structure

```text
CloudVault/
├── Backend/
│   ├── prisma/
│   └── src/
├── Frontend/
│   └── src/
├── deploy/
│   └── docker/
└── README.md
```

## 🚀 Getting Started

### Prerequisites

- Node.js 24+
- npm 10+
- Docker and Docker Compose
- PostgreSQL 16+
- Redis 7+
- MinIO or AWS S3

### 1. Clone the repository

```bash
git clone https://github.com/MSuhail7860/CloudVault.git
cd CloudVault
```

### 2. Install dependencies

```bash
npm --prefix Backend install
npm --prefix Frontend install
```

### 3. Configure environment variables

Copy the example files:

```bash
cp Backend/.env.example Backend/.env
cp Frontend/.env.example Frontend/.env
```

Configure the backend environment with your database, JWT, Redis, and S3-compatible storage credentials.

Never commit actual credentials or environment files.

### 4. Start local infrastructure

```bash
cd deploy/docker
docker compose up -d postgres redis minio
```

### 5. Apply database migrations

From the repository root:

```bash
npx --prefix Backend prisma migrate dev
```

### 6. Start the application

Run each command in a separate terminal from the repository root.

**Backend API**
```bash
npm --prefix Backend run dev
```

**Background worker**
```bash
npm --prefix Backend run worker
```

**Frontend**
```bash
npm --prefix Frontend run dev
```

### Local endpoints

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| API readiness | http://localhost:8000/health/ready |
| Worker readiness | http://localhost:8001/health/ready |

## 🧪 Testing

CloudVault includes unit, integration, browser E2E, and production configuration tests.

| Test suite | Command |
|---|---|
| Backend unit tests | `npm --prefix Backend test` |
| Integration tests | `npm --prefix Backend run test:integration` |
| Browser E2E tests | `npm --prefix Backend run test:e2e` |
| Production config tests | `python3 deploy/docker/test-production-config.py` |
| Backend build | `npm --prefix Backend run build` |
| Frontend build | `npm --prefix Frontend run build` |
| Frontend lint | `npm --prefix Frontend run lint` |

Latest recorded test results:

- Backend unit tests: 375 passed
- Integration tests: 24 passed
- Production configuration tests: 17 passed
- Playwright E2E: 2 passed

## 🔒 Storage Versioning

CloudVault implements file versioning at the application level using immutable object keys.

**Important:** The underlying S3/MinIO bucket must have bucket-level versioning disabled. This is required by CloudVault's physical object deletion and cleanup design.

Run the storage preflight check before deployment:

```bash
npm --prefix Backend run storage:preflight
```

## 💾 Backup & Recovery

Backup and recovery scripts are available in `deploy/docker/`.

| Script | Purpose |
|---|---|
| `backup.sh` | Creates database and object storage backups |
| `verify-backup.sh` | Verifies backup integrity and authentication |
| `restore.sh` | Restores data with recovery safeguards |
| `backup-integrity.py` | Validates backup manifests and checksums |
| `restore-consistency.py` | Checks restoration consistency |

For usage instructions and recovery requirements, see the scripts and deployment documentation in `deploy/docker/`.

## 🚢 Production Deployment

Production Docker Compose configuration is provided in:

```text
deploy/docker/compose.production.yaml
```

Before deployment, provision and validate:

- Managed PostgreSQL with TLS and separate pooled and direct connections.
- Redis with TLS, authentication, and persistence.
- Private S3-compatible storage with least-privilege credentials.
- Verified Resend email domain and API key.
- Domain, DNS, HTTPS, and reverse proxy.
- Distinct production JWT secrets.
- Secure secret injection and encrypted off-site backups.

Validate the production environment before deployment:

```bash
python3 deploy/docker/production-config-check.py \
  --env-file deploy/docker/.env.production
```

**Do not run production migrations or deploy the production stack until the external infrastructure and production configuration have been provisioned and validated.**

## 📄 License

This project is intended for educational, portfolio, and production reference purposes.
