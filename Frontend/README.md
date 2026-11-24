# CloudVault Frontend

Single-page web application (SPA) for CloudVault, providing secure cloud file storage, nested folder navigation, application-level file versioning, direct and public sharing, activity feeds, and account management.

For complete project documentation, system architecture, disaster recovery, and backend setup, see the root [README.md](../README.md).

---

## 🛠️ Technology Stack

- **Framework:** [React 19](https://react.dev/)
- **Build Tool & Dev Server:** [Vite](https://vite.dev/)
- **Language:** TypeScript (strict mode)
- **Styling:** [Tailwind CSS 4](https://tailwindcss.com/) with `@tailwindcss/vite`
- **Routing:** [React Router 7](https://reactrouter.com/)
- **Server State & Caching:** [TanStack React Query](https://tanstack.com/query)
- **HTTP Client:** [Axios](https://axios-http.com/) with automated JWT refresh interceptors
- **Icons:** [Lucide React](https://lucide.dev/)
- **Testing:** [Playwright](https://playwright.dev/) for browser end-to-end testing

---

## 🏗️ Architecture & Key Modules

- `src/pages/` — Route-level views:
  - `LoginPage.tsx` & `RegisterPage.tsx` — Authentication and account creation.
  - `VerifyEmailPage.tsx` — Email verification token confirmation.
  - `DashboardPage.tsx` — Core file and folder browser, breadcrumbs, search, and storage usage.
  - `AccountSettingsPage.tsx` — Profile details, password updates, and account deletion.
  - `TrashPage.tsx` — Soft-deleted files, version-aware restore, and permanent deletion.
  - `SharesPage.tsx` & `SharedWithMePage.tsx` — Outbound and inbound collaboration.
  - `PublicSharePage.tsx` — Public share link view and file download.
  - `ActivityPage.tsx` — Audit trail for file and folder actions.
- `src/components/` — Modals and reusable UI elements (upload modals, share modals, version history dialogs, file previewers).
- `src/lib/` — Shared application utilities:
  - `axios.ts` — Configured Axios instance with request ID tracking (`X-Request-ID`) and single-flight concurrent token refresh.
  - `auth.ts` — Authentication state helpers and session storage token management (`tokenStorage`).
  - `api.ts` & `files.ts` — Strongly-typed API clients.

---

## 💻 Local Development

### 1. Installation

From the repository root:

```bash
npm --prefix Frontend install
```

Or from within the `Frontend/` directory:

```bash
cd Frontend
npm install
```

### 2. Environment Configuration

Copy the example environment configuration:

```bash
cp Frontend/.env.example Frontend/.env.local
```

Configure `Frontend/.env.local`:

```env
VITE_API_BASE_URL=http://localhost:8000/api/v1
```

*(In containerized production deployments, Nginx reverse-proxies `/api/v1` to the API server on the internal Docker network, so `VITE_API_BASE_URL` defaults to `/api/v1`.)*

### 3. Available Scripts

All scripts can be executed from the `Frontend/` directory:

- `npm run dev` — Starts the Vite development server with Hot Module Replacement (default: `http://localhost:5173` or `http://localhost:3000` when configured).
- `npm run build` — Runs TypeScript project compilation (`tsc -b`) and bundles production assets into `Frontend/dist/`.
- `npm run lint` — Runs ESLint across all TypeScript and React source files (`eslint .`).
- `npm run preview` — Previews the production build locally via Vite (`vite preview`).
- `npm run test:e2e` — Executes Playwright end-to-end browser tests against a running CloudVault deployment (`playwright test`).
