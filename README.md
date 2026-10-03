# ☁️ CloudVault

A full-stack cloud file storage and collaboration platform for securely storing, organizing, managing, and sharing files.

> **Project Status:** 🚧 In Development

---

## ✨ Features

- 🔐 **Authentication & Authorization** — Registration, login, JWT access/refresh tokens, protected routes, and role-based authorization
- 📁 **File Management** — Upload, download, rename, move, delete, search, and manage file metadata
- 📂 **Folder Management** — Create, rename, delete, and organize nested folders
- 🤝 **File Sharing** — Share files with users, manage permissions, and create public/expiring links
- 🗑️ **Trash & Recovery** — Soft deletion, restoration, and permanent deletion
- 🕐 **File Versioning** — Maintain, download, and restore previous file versions
- 🔎 **Search** — Search files and folders by relevant metadata
- 📊 **Storage Dashboard** — Track storage usage, file counts, folder counts, and file types
- ⚙️ **Background Processing** — Handle tasks such as metadata extraction, thumbnails, checksums, and cleanup through background workers
- 📝 **Activity Tracking** — Record important file and sharing actions

---

## 🛠️ Tech Stack

### Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS

### Backend

- Node.js
- Express.js
- TypeScript
- REST API
- Swagger / OpenAPI

### Database & Storage

- PostgreSQL
- Prisma ORM
- AWS S3
- MinIO for local development

### Caching & Background Processing

- Redis
- BullMQ

### DevOps & Deployment

- Docker
- Docker Compose
- GitHub Actions
- Nginx

### Testing

- Jest
- Supertest

---

## 🏗️ Architecture

```text
                         ┌──────────────────────┐
                         │      Next.js         │
                         │      Frontend        │
                         └──────────┬───────────┘
                                    │
                              REST / HTTP
                                    │
                         ┌──────────▼───────────┐
                         │      Backend API     │
                         │ Node.js / Express    │
                         └──────┬────────┬──────┘
                                │        │
                  ┌─────────────┘        └─────────────┐
                  │                                    │
          ┌───────▼────────┐                   ┌───────▼────────┐
          │   PostgreSQL   │                   │  Object Store  │
          │                │                   │                │
          │ Users          │                   │ AWS S3 / MinIO │
          │ Files          │                   │                │
          │ Folders        │                   │ Actual Files   │
          │ Shares         │                   └────────────────┘
          │ Permissions    │
          │ Activities     │
          └────────────────┘
                  │
          ┌───────▼────────┐
          │     Redis      │
          │ Cache / Queue  │
          └───────┬────────┘
                  │
          ┌───────▼────────┐
          │ Background     │
          │ Workers        │
          │ BullMQ         │
          └────────────────┘
```

Large files can be uploaded directly to object storage using secure presigned URLs, reducing unnecessary traffic through the backend server.

---

## 🚀 Setup / Installation

### Prerequisites

- Node.js 20+
- npm / pnpm
- PostgreSQL
- Redis
- Docker
- Docker Compose
- AWS S3 or MinIO

### 1. Clone the Repository

```bash
git clone <repository-url>
cd cloud-vault
```

### 2. Install Dependencies

Backend:

```bash
cd backend
npm install
```

Frontend:

```bash
cd ../frontend
npm install
```

### 3. Start Infrastructure

```bash
docker compose up -d
```

### 4. Configure the Database

```bash
cd backend
npx prisma migrate dev
npx prisma generate
```

### 5. Run the Application

Backend:

```bash
cd backend
npm run dev
```

Frontend:

```bash
cd frontend
npm run dev
```

Default development URLs:

```text
Frontend: http://localhost:3000
Backend:  http://localhost:8000
API Docs: http://localhost:8000/docs
```

---

## 🔐 Environment Variables

Create a `.env` file in the backend directory:

```env
# Application
PORT=8000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/cloud_storage

# JWT
JWT_ACCESS_SECRET=your_access_secret
JWT_REFRESH_SECRET=your_refresh_secret
ACCESS_TOKEN_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d

# Redis
REDIS_URL=redis://localhost:6379

# Object Storage
STORAGE_PROVIDER=minio
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=cloud-files
S3_ACCESS_KEY=your_access_key
S3_SECRET_KEY=your_secret_key

# Frontend
FRONTEND_URL=http://localhost:3000
```

> Never commit real secrets, API keys, passwords, or cloud credentials to Git.

---

## 🔌 API Overview

The API is versioned under `/api/v1`.

### Authentication

```http
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
GET  /api/v1/auth/me
```

### Files

```http
POST   /api/v1/files/upload-url
POST   /api/v1/files/complete
GET    /api/v1/files
GET    /api/v1/files/:id/download
PATCH  /api/v1/files/:id
DELETE /api/v1/files/:id
```

### Folders

```http
POST   /api/v1/folders
GET    /api/v1/folders/:id
PATCH  /api/v1/folders/:id
DELETE /api/v1/folders/:id
```

### Sharing

```http
POST   /api/v1/files/:id/share
GET    /api/v1/files/:id/shares
DELETE /api/v1/files/:id/shares/:shareId
```

For complete API documentation, use the Swagger / OpenAPI interface available at `/docs` when running the backend locally.

---

## 🔒 Security

- Password hashing
- JWT expiration
- Refresh-token rotation
- Authentication and authorization checks
- File ownership validation
- Input validation
- File type and size validation
- Rate limiting
- Secure HTTP headers
- CORS configuration
- Expiring presigned URLs
- Secure object-storage access
- Protection against path traversal
- Environment-based secret management

---

## 🧪 Testing

Run backend tests:

```bash
cd backend
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

Testing uses Jest and Supertest.

---

## 🚀 Deployment

The application is containerized with Docker and can be deployed to a cloud environment such as AWS.

A production deployment can use:

```text
Internet
    │
    ▼
Load Balancer / Nginx
    │
    ▼
Application
    │
    ├── PostgreSQL
    ├── Redis
    └── AWS S3
```

GitHub Actions can automate testing, Docker image builds, and deployment.

---

## 📄 License

This project is intended for educational and portfolio purposes.

```text
MIT License
```
