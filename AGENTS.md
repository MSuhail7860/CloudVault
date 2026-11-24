# CloudVault Agent Instructions

## Project structure and architecture

CloudVault is a two-application project:

- `Backend/` — Node.js, Express, TypeScript API.
  - `src/routes/v1/` defines versioned HTTP routes.
  - `src/controllers/` validates HTTP input and formats responses.
  - `src/services/` owns business logic and coordinates Prisma, object storage, and jobs.
  - `src/config/` contains database and Redis setup.
  - `src/middleware/` contains authentication, uploads, rate limiting, and error handling.
  - `src/jobs/` contains BullMQ queues, workers, and processors.
  - `prisma/` contains the schema and migrations.
  - `src/**/__tests__/` and `src/__tests__/` contain backend tests.
- `Frontend/` — React, TypeScript, Vite, Tailwind CSS, and React Router.
  - `src/pages/` contains route-level pages.
  - `src/components/` contains shared React components.
  - `src/lib/` contains Axios configuration, authentication helpers, API functions, and API types.

Keep controllers thin. Put domain behavior in services, keep persistence in Prisma-backed services, and reuse existing API helpers, types, components, and utilities before adding new abstractions.

## Technology and boundaries

- Backend: Express 5, Prisma 7 with PostgreSQL, AWS S3-compatible storage, Redis, BullMQ, JWT via `jose`, and Vitest/Supertest.
- Frontend: React 19, Vite, TypeScript, Tailwind CSS 4, React Router, Axios, TanStack React Query, and Lucide icons.
- Backend uses ESM imports with `.js` extensions and strict TypeScript settings.
- Frontend uses Vite/bundler module resolution and strict unused-code checks.
- Routes handle HTTP concerns; controllers validate and serialize; services enforce ownership, authorization, validation, and business rules; storage and queue modules handle infrastructure concerns.
- Preserve existing response shapes and convert Prisma `BigInt` file sizes to strings at API boundaries.

## Authentication and token refresh

- Protected backend routes use `authenticate` and require a Bearer access token.
- Access tokens are short-lived JWTs; refresh tokens are longer-lived JWTs whose hashes are stored in PostgreSQL.
- Refresh tokens must be rotated transactionally, with the previous token revoked and the replacement persisted.
- Never log, persist, or expose raw refresh tokens except when returning them to the authenticated client during login or refresh.
- Frontend tokens are stored through `tokenStorage` in `sessionStorage`. Reuse the Axios interceptors for attaching access tokens and coordinating one concurrent refresh request.
- Authentication endpoints must not recursively trigger the refresh interceptor. Clear both tokens when refresh fails or logout completes.

## Files, storage, Redis, and BullMQ

- File ownership must be checked before listing, downloading, renaming, moving, versioning, sharing, restoring, or deleting files.
- Use the existing S3-compatible storage service for object operations. Do not expose storage credentials or allow clients to choose arbitrary storage keys.
- Uploads use Multer memory storage and are limited to 10 MB. Validate names, MIME types, sizes, and folder ownership before completing the operation.
- Upload the object before creating its database record; if record creation fails, clean up the object while preserving the original error.
- File processing is queued only after the database record exists. Redis/BullMQ failures may use the existing inline fallback and must not delete a successfully uploaded file.
- Use the existing queue names, retry/backoff settings, job IDs, worker lifecycle, and graceful shutdown helpers.
- File versions preserve prior storage keys and database metadata. Permanent deletion must remove current and historical objects before deleting the database record.
- Redis may be disabled through the existing configuration. Do not make normal API startup depend on a running Redis instance.

## API and error handling

- Return the established JSON shape: `{ success: boolean, message?: string, data?: ... }`; preserve existing status codes and messages where possible.
- Validate request bodies, params, and query strings in controllers before calling services.
- Use `AppError` for expected operational failures with an appropriate HTTP status.
- Pass controller failures to `next(error)` and let `errorHandler` handle malformed JSON, Multer errors, operational errors, and unexpected errors.
- Do not leak stack traces, credentials, storage details, SQL/Prisma internals, or other sensitive information in responses.
- Keep public share-token validation in the share service and return the existing generic unavailable response for invalid, expired, revoked, or deleted links.

## Testing and builds

Run commands from the relevant package directory:

- Backend: `npm run build`, `npm test`, `npm run test:watch`, `npm run dev`, `npm run start`, `npm run worker`.
- Frontend: `npm run build`, `npm run lint`, `npm run dev`, `npm run preview`.

Add or update focused backend tests for service, controller, route, queue, or processor changes. Run the relevant tests plus the package build after implementation. Do not assume a frontend test runner exists; use the configured build and lint commands for frontend verification.

## Security requirements

- Never commit `.env` files, secrets, JWT keys, database credentials, Redis credentials, S3 credentials, or raw tokens. Use `Backend/.env.example` for documented variable names only.
- Keep access and refresh secrets separate and strong; do not hard-code secrets.
- Enforce authentication and resource ownership on every private file, folder, version, activity, dashboard, and share-management operation.
- Keep CORS restricted to configured frontend origins, retain Helmet and rate limiting, and preserve authentication rate limits.
- Treat filenames, MIME types, IDs, query parameters, upload contents, and share recipients as untrusted input.
- Do not allow path traversal, arbitrary object-key access, cross-user folder/file access, or access to trashed/expired/revoked shared files.

## Git safety

- Never commit or push unless explicitly requested.
- Preserve existing uncommitted changes; inspect `git status` before editing and avoid overwriting unrelated work.
- Never use destructive commands such as `git reset --hard`, `git checkout --`, or broad deletion commands.
- Keep changes scoped to the requested task and review the diff before handoff.
