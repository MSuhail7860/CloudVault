import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sendVerificationEmail,
  takeCapturedVerificationEmails,
} from "../emailService.js";

const originalEnv = {
  nodeEnv: process.env.NODE_ENV,
  provider: process.env.EMAIL_PROVIDER,
  frontendUrl: process.env.FRONTEND_URL,
  from: process.env.EMAIL_FROM,
  resendKey: process.env.RESEND_API_KEY,
};

afterEach(() => {
  for (const message of takeCapturedVerificationEmails()) {
    void message;
  }
  for (const [key, value] of Object.entries({
    NODE_ENV: originalEnv.nodeEnv,
    EMAIL_PROVIDER: originalEnv.provider,
    FRONTEND_URL: originalEnv.frontendUrl,
    EMAIL_FROM: originalEnv.from,
    RESEND_API_KEY: originalEnv.resendKey,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

describe("verification email delivery", () => {
  it("captures test messages without writing tokens to logs", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.EMAIL_PROVIDER;
    process.env.FRONTEND_URL = "http://localhost:3000";
    const token = "A".repeat(43);

    await expect(
      sendVerificationEmail("person@example.test", token),
    ).resolves.toBeUndefined();

    const [message] = takeCapturedVerificationEmails();
    expect(message?.to).toBe("person@example.test");
    const link = message?.text.match(/https?:\/\/\S+/)?.[0];
    expect(link).toBeDefined();
    expect(new URL(link!).search).toBe("");
    expect(new URLSearchParams(new URL(link!).hash.slice(1)).get("token")).toBe(
      token,
    );
    expect(message?.html).toContain("Verify email");
  });

  it("fails closed in production when the email provider is not configured", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.EMAIL_PROVIDER;
    process.env.FRONTEND_URL = "https://cloudvault.example";

    await expect(
      sendVerificationEmail("person@example.test", "A".repeat(43)),
    ).rejects.toThrow("Email delivery provider is not configured");
  });

  it("does not expose provider response details or the API key on delivery failure", async () => {
    process.env.NODE_ENV = "production";
    process.env.EMAIL_PROVIDER = "resend";
    process.env.EMAIL_FROM = "CloudVault <no-reply@example.com>";
    process.env.RESEND_API_KEY = "local-test-key";
    process.env.FRONTEND_URL = "https://cloudvault.example";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("sensitive provider response", { status: 500 }),
      ),
    );

    await expect(
      sendVerificationEmail("person@example.test", "A".repeat(43)),
    ).rejects.toThrow("Verification email delivery failed");
  });
});
