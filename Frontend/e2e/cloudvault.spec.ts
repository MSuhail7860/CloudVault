import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const mailDirectory = process.env.E2E_MAIL_CAPTURE_DIRECTORY;
const apiBaseUrl =
  process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8000/api/v1";

if (!mailDirectory) {
  throw new Error("E2E mail capture directory was not configured");
}

interface CapturedEmail {
  to: string;
  text: string;
}

const readVerificationUrl = async (email: string): Promise<string> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const files = await readdir(mailDirectory);
    for (const file of files) {
      const message = JSON.parse(
        await readFile(path.join(mailDirectory, file), "utf8"),
      ) as CapturedEmail;
      if (message.to !== email) continue;
      const url = message.text.match(/https?:\/\/\S+/)?.[0];
      if (url) return url;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Local verification message was not captured");
};

const loginInBrowser = async (
  page: Page,
  email: string,
  password: string,
): Promise<void> => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("complementary").getByRole("button", { name: "My Files" }),
  ).toBeVisible();
};

test.beforeEach(async ({ context }) => {
  const testClientId = `e2e-test-${randomUUID()}`;
  await context.setExtraHTTPHeaders({
    "x-test-client-id": testClientId,
  });
});

test("registration through account deletion and file lifecycle", async ({
  page,
  request,
}) => {
  const email = `browser-${randomUUID()}@example.test`;
  const initialPassword = "Browser-owner-password-1";
  const verifiedPassword = "Browser-owner-password-2";
  let currentPassword = initialPassword;
  let accountDeletionScheduled = false;

  try {
    await page.goto("/register");
    await page.getByLabel("Full name").fill("Browser Test Owner");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(initialPassword);
    await page.getByLabel("Confirm password").fill(initialPassword);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL("/login");
    await expect(
      page.getByText(/Account created\. Check your email/),
    ).toBeVisible();

    await page.goto(await readVerificationUrl(email));
    await expect(
      page.getByRole("heading", { name: "Verify your email" }),
    ).toBeVisible();
    await page.getByLabel("New password", { exact: true }).fill(verifiedPassword);
    await page.getByLabel("Confirm password").fill(verifiedPassword);
    await page.getByRole("button", { name: "Verify email and set password" }).click();
    await expect(
      page.getByRole("heading", { name: "Email verified" }),
    ).toBeVisible();

    currentPassword = verifiedPassword;
    await loginInBrowser(page, email, currentPassword);

    await page.locator('input[type="file"]').first().setInputFiles({
      name: "browser-lifecycle.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Browser lifecycle test file"),
    });
    await expect(page.getByText("browser-lifecycle.txt", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "More actions for browser-lifecycle.txt" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("browser-lifecycle.txt");
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error("The browser download was not saved");
    expect(await readFile(downloadPath)).toEqual(
      Buffer.from("Browser lifecycle test file"),
    );

    await page.getByRole("button", { name: "More actions for browser-lifecycle.txt" }).click();
    await page.getByRole("button", { name: "Version History" }).click();
    const versionDialog = page.getByRole("dialog");
    await versionDialog.getByRole("button", { name: "Upload New Version" }).click();
    await page.locator('input[type="file"]').last().setInputFiles({
      name: "browser-lifecycle-v2.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Browser lifecycle version two"),
    });
    await expect(versionDialog.getByText("Version 1", { exact: true })).toBeVisible();
    await versionDialog.getByRole("button", { name: "Close dialog" }).click();

    const versionedFileName = "browser-lifecycle-v2.txt";
    await expect(page.getByText(versionedFileName, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: `More actions for ${versionedFileName}` }).click();
    await page.getByRole("button", { name: "Share link" }).click();
    const shareDialog = page.getByRole("dialog");
    await shareDialog.getByRole("button", { name: "Create share link" }).click();
    const shareUrl = await shareDialog.getByLabel("Share URL").inputValue();
    const sharedDownloadPromise = page.waitForEvent("download");
    await page.evaluate((url) => window.location.assign(url), shareUrl);
    const sharedDownload = await sharedDownloadPromise;
    expect(sharedDownload.suggestedFilename()).toBe(versionedFileName);
    const sharedDownloadPath = await sharedDownload.path();
    if (!sharedDownloadPath) throw new Error("The shared download was not saved");
    expect(await readFile(sharedDownloadPath)).toEqual(
      Buffer.from("Browser lifecycle version two"),
    );
    await shareDialog.getByRole("button", { name: "Done" }).click();

    await page.getByRole("button", { name: /Create folder Organize your files/ }).click();
    const folderDialog = page.getByRole("dialog");
    await folderDialog.getByLabel("Folder name").fill("Browser test folder");
    await folderDialog.getByRole("button", { name: "Create folder", exact: true }).click();
    await expect(page.getByText("Browser test folder", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: `More actions for ${versionedFileName}` }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Move to Trash" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Moved" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    await expect(page.getByText(versionedFileName, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await page.getByRole("complementary").getByRole("button", {
      name: "My Files",
      exact: true,
    }).click();
    await expect(page.getByText(versionedFileName, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: `More actions for ${versionedFileName}` }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Move to Trash" }).click();
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    await expect(page.getByText(versionedFileName, { exact: true })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "permanently deleted" }),
    ).toBeVisible();

    await page.evaluate(() => {
      sessionStorage.setItem("cloudvault_access_token", "expired-access-token");
      sessionStorage.setItem("cloudvault_refresh_token", "expired-refresh-token");
    });
    await page.goto("/");
    await expect(page).toHaveURL("/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

    await loginInBrowser(page, email, currentPassword);
    await page.locator('button[aria-haspopup="menu"]').click();
    await page.getByText("Account Settings", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Account Settings" })).toBeVisible();

    await page.getByLabel("Current password").fill(currentPassword);
    await page.getByLabel("New password", { exact: true }).fill("Browser-owner-password-3");
    await page.getByLabel("Confirm new password", { exact: true }).fill("Browser-owner-password-3");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page).toHaveURL("/login");
    await expect(page.getByText(/Password changed successfully/)).toBeVisible();
    currentPassword = "Browser-owner-password-3";

    await loginInBrowser(page, email, currentPassword);
    await page.locator('button[aria-haspopup="menu"]').click();
    await page.getByRole("menuitem", { name: "Log Out" }).click();
    await expect(page).toHaveURL("/login");
    await page.goto("/");
    await expect(page).toHaveURL("/login");

    await loginInBrowser(page, email, currentPassword);
    await page.locator('button[aria-haspopup="menu"]').click();
    await page.getByText("Account Settings", { exact: true }).click();
    await page.getByRole("button", { name: "Delete account" }).click();
    const deletionDialog = page.getByRole("dialog");
    await deletionDialog.getByLabel("Current password").fill(currentPassword);
    await deletionDialog.getByRole("checkbox").check();
    await deletionDialog.getByRole("button", { name: "Delete my account" }).click();
    await expect(page).toHaveURL("/login");
    await expect(page.getByText(/Account deletion has been scheduled/)).toBeVisible();
    accountDeletionScheduled = true;
  } finally {
    if (!accountDeletionScheduled) {
      const login = await request.post(`${apiBaseUrl}/auth/login`, {
        data: { email, password: currentPassword },
      });
      if (login.ok()) {
        const { accessToken } = (await login.json()).data as {
          accessToken: string;
        };
        await request.delete(`${apiBaseUrl}/auth/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          data: { currentPassword },
        });
      }
    }
  }
});

test("verification errors and expired sessions do not expose protected pages", async ({
  page,
}) => {
  await page.goto("/verify-email#token=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  await page.getByLabel("New password").fill("Browser-owner-password-1");
  await page.getByLabel("Confirm password").fill("Browser-owner-password-1");
  await page.getByRole("button", { name: "Verify email and set password" }).click();
  await expect(
    page.getByRole("heading", { name: "Verification unavailable" }),
  ).toBeVisible();

  await page.evaluate(() => {
    sessionStorage.setItem("cloudvault_access_token", "invalid-access-token");
    sessionStorage.setItem("cloudvault_refresh_token", "invalid-refresh-token");
  });
  await page.goto("/");
  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});
