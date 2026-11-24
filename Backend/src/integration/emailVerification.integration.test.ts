import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../config/database.js";
import app from "../app.js";
import {
  registerUser,
  verifyEmailAddress,
} from "../services/authService.js";
import { takeCapturedVerificationEmails } from "../services/emailService.js";

const registeredEmails = new Set<string>();

const tokenFromCapturedEmail = (): string => {
  const [message] = takeCapturedVerificationEmails();
  if (!message) throw new Error("Verification email was not captured");

  const link = message.text.match(/https?:\/\/\S+/)?.[0];
  if (!link) throw new Error("Verification link was not included in the email");
  return new URLSearchParams(new URL(link).hash.slice(1)).get("token") ?? "";
};

describe("email verification with PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  afterEach(async () => {
    if (registeredEmails.size) {
      await prisma.user.deleteMany({
        where: { email: { in: [...registeredEmails] } },
      });
    }
    registeredEmails.clear();
    takeCapturedVerificationEmails();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("verifies a newly registered email once and rejects token replay", async () => {
    const email = `verification-${randomUUID()}@example.test`;
    registeredEmails.add(email);

    const registered = await registerUser(email, "integration-password-1");
    if (!registered) throw new Error("New integration account was not created");
    expect(registered.emailVerifiedAt).toBeNull();

    const token = tokenFromCapturedEmail();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await verifyEmailAddress(token, "owner-selected-password-1");

    const verified = await prisma.user.findUnique({
      where: { id: registered.id },
      select: { emailVerifiedAt: true },
    });
    expect(verified?.emailVerifiedAt).toBeInstanceOf(Date);
    await expect(
      verifyEmailAddress(token, "owner-selected-password-2"),
    ).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("rejects expired verification links without verifying the account", async () => {
    const email = `verification-expired-${randomUUID()}@example.test`;
    registeredEmails.add(email);

    const registered = await registerUser(email, "integration-password-1");
    if (!registered) throw new Error("New integration account was not created");
    const token = tokenFromCapturedEmail();
    await prisma.emailVerificationToken.update({
      where: { userId: registered.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      verifyEmailAddress(token, "owner-selected-password-1"),
    ).rejects.toMatchObject({
      statusCode: 400,
    });
    const user = await prisma.user.findUnique({
      where: { id: registered.id },
      select: { emailVerifiedAt: true },
    });
    expect(user?.emailVerifiedAt).toBeNull();
  });

  it("verifies and claims an account through HTTP, then invalidates all sessions on logout", async () => {
    const email = `verification-http-${randomUUID()}@example.test`;
    registeredEmails.add(email);

    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({ email, password: "attacker-chosen-password" });
    expect(registration.status).toBe(202);

    const token = tokenFromCapturedEmail();
    const verification = await request(app)
      .post("/api/v1/auth/verification/verify")
      .send({ token, password: "owner-controlled-password" });
    expect(verification.status).toBe(200);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: "owner-controlled-password" });
    expect(login.status).toBe(200);
    expect(login.body.data.user.email).toBe(email);
    expect(login.body.data.user.emailVerifiedAt).toBeTruthy();

    const { accessToken, refreshToken } = login.body.data;
    const authenticated = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer " + accessToken);
    expect(authenticated.status).toBe(200);

    const passwordChange = await request(app)
      .patch("/api/v1/auth/password")
      .set("Authorization", "Bearer " + accessToken)
      .send({
        currentPassword: "owner-controlled-password",
        newPassword: "updated-owner-password",
      });
    expect(passwordChange.status).toBe(200);

    const staleAccessAfterPasswordChange = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer " + accessToken);
    expect(staleAccessAfterPasswordChange.status).toBe(401);

    const staleRefreshAfterPasswordChange = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken });
    expect(staleRefreshAfterPasswordChange.status).toBe(401);

    const relogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: "updated-owner-password" });
    expect(relogin.status).toBe(200);

    const logout = await request(app)
      .post("/api/v1/auth/logout")
      .send({ refreshToken: relogin.body.data.refreshToken });
    expect(logout.status).toBe(200);

    const staleAccess = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer " + relogin.body.data.accessToken);
    expect(staleAccess.status).toBe(401);

    const staleRefresh = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: relogin.body.data.refreshToken });
    expect(staleRefresh.status).toBe(401);
  });
});
