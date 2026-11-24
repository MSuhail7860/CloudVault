# CloudVault Production Smoke-Test Procedure

This document defines the safe, non-destructive smoke-test procedure to execute after initial deployment to real production infrastructure.

> **IMPORTANT**:
> - Never execute this procedure using existing user credentials or real customer data.
> - Run all tests using a dedicated disposable account (e.g. `smoke-test-<uuid>@<verified-domain>`).
> - Do not execute against production until the owner explicitly approves deployment.

---

## 1. Prerequisites Verification

Before initiating any application traffic, verify that all external services report healthy status:

1. **Edge Reverse Proxy & TLS**:
   ```sh
   curl -Iv https://<production-domain>/healthz
   ```
   *Expected result*: HTTP 200 with standard security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`).

2. **API Readiness Probe**:
   ```sh
   curl -fsS https://<production-domain>/api/v1/health
   ```
   *Expected result*: HTTP 200 `{"success": true, "message": "Database and server are healthy"}`.

3. **Production Container Health**:
   ```sh
   docker compose --file deploy/docker/compose.production.yaml ps
   ```
   *Expected result*: `api`, `worker`, and `frontend` services report `healthy`.

---

## 2. End-to-End Workflow Verification

Execute the following sequential test cases using a test browser session or API client:

### Step 2.1: User Registration & Real Email Delivery
1. Navigate to `https://<production-domain>/register`.
2. Register a dedicated test account: `smoke-test-<timestamp>@<verified-domain>`.
3. Verify that the Resend API sends a verification email.
4. Check inbox and click the single-use verification link.
5. Confirm browser is redirected to `/verify-email?token=...` and displays verification success.

### Step 2.2: Authentication & Token Lifecycle
1. Navigate to `https://<production-domain>/login`.
2. Authenticate with the test account credentials.
3. Confirm browser receives `accessToken` and `refreshToken` and lands on `/`.
4. Inspect response headers: confirm `X-Request-ID` is present on every API response.

### Step 2.3: Folder Creation & Navigation
1. Create a top-level folder: `smoke-folder-<timestamp>`.
2. Open the folder and verify breadcrumb navigation displays `/ My Files / smoke-folder-...`.

### Step 2.4: File Upload, Metadata & Background Processing
1. Upload a small test file (`smoke-file.txt`, ~10 KB).
2. Confirm the file appears in the directory listing.
3. Verify worker logs confirm background processing completed:
   ```sh
   docker compose --file deploy/docker/compose.production.yaml logs --tail=50 worker
   ```
   *Expected output*: `[Worker] File job <id> completed.`

### Step 2.5: Secure Download & Content Verification
1. Download `smoke-file.txt` from the dashboard.
2. Verify downloaded SHA-256 matches the original uploaded content.
3. Confirm that direct unauthenticated requests to the download URL without Bearer token return HTTP 401.

### Step 2.6: File Versioning
1. Upload a second version of `smoke-file.txt` with altered content.
2. View version history modal: confirm version 1 and version 2 are both listed.
3. Download version 1: confirm original content is preserved.
4. Restore version 1: confirm version 1 becomes active.

### Step 2.7: Secure Sharing
1. Generate a share link for `smoke-file.txt` with `VIEW` permissions.
2. Open the share link in an incognito browser window without authenticating.
3. Confirm file preview is visible.
4. Revoke the share link from the dashboard: confirm subsequent incognito visits return HTTP 404/410.

### Step 2.8: Trash, Restoration & Permanent Deletion
1. Move `smoke-file.txt` to trash.
2. Confirm it disappears from `/` and appears under `/trash`.
3. Restore `smoke-file.txt`: confirm it returns to `/`.
4. Move back to trash and select "Delete permanently".
5. Confirm file is removed from PostgreSQL and storage object is deleted from S3.

### Step 2.9: Account Deletion (Asynchronous Queue Verification)
1. Navigate to `/settings`.
2. Under "Delete Account", enter the account password and confirm deletion.
3. Confirm API returns HTTP 202 Accepted.
4. Confirm browser is immediately logged out and subsequent login attempts return HTTP 401.
5. Monitor worker logs to verify asynchronous deletion queue processing:
   ```sh
   docker compose --file deploy/docker/compose.production.yaml logs -f worker
   ```
   *Expected output*: `[Worker] Account deletion job <id> completed.`
6. Verify database records for the test user have been removed.

---

## 3. Monitoring & Alert Verification

1. Verify Prometheus / Grafana receives metrics from `/health/ready`.
2. Confirm no alerts in `deploy/docker/prometheus-alerts.yaml` fired during the smoke test.
3. Check error logging: verify that `X-Request-ID` is present on any test 4xx error logs.
