import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const authMocks = vi.hoisted(() => ({
  comparePassword: vi.fn(),
  hashPassword: vi.fn(),
  verifyAccessToken: vi.fn(),
  enqueueAccountDeletionJob: vi.fn(),
}));

vi.mock("bcrypt", () => ({
  default: {
    compare: authMocks.comparePassword,
    hash: authMocks.hashPassword,
  },
}));

vi.mock("../utils/jwt.js", () => ({
  createAccessToken: vi.fn(),
  createRefreshToken: vi.fn(),
  verifyAccessToken: authMocks.verifyAccessToken,
  verifyRefreshToken: vi.fn(),
}));

vi.mock("../config/database.js", () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    folder: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    file: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    shareLink: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    accountDeletionTask: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("../services/storageService.js", () => ({
  checkStorageConnection: vi.fn(),
  uploadObject: vi.fn(),
  downloadObject: vi.fn(),
  deleteObject: vi.fn(),
}));

vi.mock("../jobs/queues.js", () => ({
  enqueueAccountDeletionJob: authMocks.enqueueAccountDeletionJob,
  enqueueFileProcessingJob: vi.fn(),
}));

import app from "../app.js";
import { prisma } from "../config/database.js";
import { checkStorageConnection } from "../services/storageService.js";

const db = vi.mocked(prisma);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(db.$executeRaw).mockResolvedValue(1 as never);
  vi.mocked(db.$transaction).mockImplementation(
    (async (callback: (transaction: unknown) => Promise<unknown>) =>
      callback(db as never)) as never,
  );
});

describe("Express application", () => {
  it("uses the configured number of trusted proxy hops", () => {
    expect(app.get("trust proxy")).toBe(
      Number(process.env.TRUST_PROXY_HOPS ?? "0"),
    );
  });

  it("returns the root API status", async () => {
    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "CloudVault API is running",
    });
  });

  it("returns the API v1 status", async () => {
    const response = await request(app).get("/api/v1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "CloudVault API v1",
    });
  });

  it("returns a 404 for an unknown route", async () => {
    const response = await request(app).get("/this-route-does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      message: "Route not found: GET /this-route-does-not-exist",
    });
  });

  it("returns a 404 for an unknown API v1 route", async () => {
    const response = await request(app).get("/api/v1/unknown");

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe("Route not found: GET /api/v1/unknown");
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: "Invalid JSON in request body",
    });
  });

  it("returns 500 through the error handler when the health DB query fails", async () => {
    vi.mocked(db.$queryRaw).mockRejectedValue(
      new Error("Database unavailable"),
    );

    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      message: "Internal server error",
    });
  });

  it("returns healthy status when the database query succeeds", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([{ "?column?": 1 }] as never);

    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "CloudVault API",
      database: "connected",
    });
  });

  it("requires authentication for the file listing endpoint", async () => {
    const response = await request(app).get("/api/v1/files");

    expect(response.status).toBe(401);
  });

  it("requires authentication to upload a file version", async () => {
    const response = await request(app).post(
      "/api/v1/files/test-file-id/versions",
    );

    expect(response.status).toBe(401);
  });

  it("requires authentication to list file versions", async () => {
    const response = await request(app).get(
      "/api/v1/files/test-file-id/versions",
    );

    expect(response.status).toBe(401);
  });

  it("requires authentication to restore a file version", async () => {
    const response = await request(app).post(
      "/api/v1/files/test-file-id/versions/test-version-id/restore",
    );

    expect(response.status).toBe(401);
  });

  it("requires authentication for folder listing", async () => {
    const response = await request(app).get("/api/v1/folders");

    expect(response.status).toBe(401);
  });

  it("requires authentication for the current-user endpoint", async () => {
    const response = await request(app).get("/api/v1/auth/me");

    expect(response.status).toBe(401);
  });

  it("requires authentication for profile updates", async () => {
    const response = await request(app)
      .patch("/api/v1/auth/me")
      .send({ name: "New Display Name" });

    expect(response.status).toBe(401);
  });

  it("requires authentication for password changes", async () => {
    const response = await request(app)
      .patch("/api/v1/auth/password")
      .send({
        currentPassword: "current-password",
        newPassword: "new-password",
      });

    expect(response.status).toBe(401);
  });

  it("requires authentication for account deletion", async () => {
    const response = await request(app)
      .delete("/api/v1/auth/me")
      .send({ currentPassword: "current-password" });

    expect(response.status).toBe(401);
  });

  it("updates the authenticated user's profile and returns a safe user", async () => {
    authMocks.verifyAccessToken.mockResolvedValue({ userId: "user-123", sessionVersion: 0 });
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({
      id: "user-123",
      accountStatus: "ACTIVE",
      sessionVersion: 0,
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    } as never).mockResolvedValueOnce({
      id: "user-123",
      accountStatus: "ACTIVE",
      sessionVersion: 0,
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    } as never);
    vi.mocked(db.user.update).mockResolvedValue({
      id: "user-123",
      email: "suhail@example.com",
      name: "New Display Name",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    } as never);

    const response = await request(app)
      .patch("/api/v1/auth/me")
      .set("Authorization", "Bearer access-token")
      .send({ name: "  New Display Name  " });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "Profile updated successfully",
      data: {
        id: "user-123",
        email: "suhail@example.com",
        name: "New Display Name",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    });
    expect(response.body.data).not.toHaveProperty("passwordHash");
    expect(response.body.data).not.toHaveProperty("refreshToken");
  });

  it("changes the authenticated user's password without exposing secrets", async () => {
    authMocks.verifyAccessToken.mockResolvedValue({ userId: "user-123", sessionVersion: 0 });
    authMocks.comparePassword.mockResolvedValue(true);
    authMocks.hashPassword.mockResolvedValue("new-password-hash");
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-123",
      accountStatus: "ACTIVE",
      sessionVersion: 0,
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      passwordHash: "current-password-hash",
    } as never);
    vi.mocked(db.$transaction).mockResolvedValue(undefined);

    const response = await request(app)
      .patch("/api/v1/auth/password")
      .set("Authorization", "Bearer access-token")
      .send({
        currentPassword: "current-password",
        newPassword: "new-password",
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "Password changed successfully",
    });
    expect(response.body).not.toHaveProperty("passwordHash");
    expect(response.body).not.toHaveProperty("refreshToken");
  });

  it("returns a generic response when a password change encounters an unexpected error", async () => {
    authMocks.verifyAccessToken.mockResolvedValue({ userId: "user-123", sessionVersion: 0 });
    authMocks.comparePassword.mockResolvedValue(true);
    authMocks.hashPassword.mockResolvedValue("new-password-hash");
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-123",
      accountStatus: "ACTIVE",
      sessionVersion: 0,
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      passwordHash: "current-password-hash",
    } as never);
    vi.mocked(db.$transaction).mockRejectedValue(
      new Error("Database unavailable"),
    );

    const response = await request(app)
      .patch("/api/v1/auth/password")
      .set("Authorization", "Bearer access-token")
      .send({
        currentPassword: "current-password",
        newPassword: "new-password",
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      message: "Internal server error",
    });
    expect(response.text).not.toContain("Database unavailable");
  });

  it("rejects previously issued access tokens for pending accounts", async () => {
    authMocks.verifyAccessToken.mockResolvedValue({ userId: "user-123", sessionVersion: 0 });
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-123",
      accountStatus: "PENDING_DELETION",
      sessionVersion: 0,
    } as never);

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer access-token");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: "Invalid or expired access token",
    });

  });

  it("rejects authenticated requests from unverified accounts", async () => {
    authMocks.verifyAccessToken.mockResolvedValue({
      userId: "user-123",
      sessionVersion: 0,
    });
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-123",
      accountStatus: "ACTIVE",
      sessionVersion: 0,
      emailVerifiedAt: null,
    } as never);

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer unverified-account-test-token");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: "Invalid or expired access token",
    });
  });

  it("rejects an otherwise valid access token from an older session epoch", async () => {
    authMocks.verifyAccessToken.mockResolvedValue({
      userId: "user-123",
      sessionVersion: 0,
    });
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "user-123",
      accountStatus: "ACTIVE",
      sessionVersion: 1,
    } as never);

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer session-epoch-test-token");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: "Invalid or expired access token",
    });
  });

  it("schedules account deletion and returns no secrets", async () => {
    authMocks.verifyAccessToken.mockResolvedValue({ userId: "user-123", sessionVersion: 0 });
    authMocks.comparePassword.mockResolvedValue(true);
    authMocks.enqueueAccountDeletionJob.mockResolvedValue(true);
    vi.mocked(db.user.findUnique)
      .mockResolvedValueOnce({
        id: "user-123",
        accountStatus: "ACTIVE",
        sessionVersion: 0,
        emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      } as never)
      .mockResolvedValueOnce({
        id: "user-123",
        passwordHash: "stored-password-hash",
        email: "suhail@example.com",
        accountStatus: "ACTIVE",
      } as never);
    vi.mocked(db.$transaction).mockImplementation(
      async (callback) =>
        callback({
          user: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          refreshToken: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          shareLink: {
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          accountDeletionTask: {
            upsert: vi.fn().mockResolvedValue({ userId: "user-123" }),
          },
        } as never),
    );

    const response = await request(app)
      .delete("/api/v1/auth/me")
      .set("Authorization", "Bearer access-token")
      .send({ currentPassword: "current-password" });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      success: true,
      message: "Account deletion has been scheduled",
    });
    expect(response.body).not.toHaveProperty("passwordHash");
    expect(response.body).not.toHaveProperty("refreshToken");
    expect(authMocks.enqueueAccountDeletionJob).toHaveBeenCalledWith(
      "user-123",
    );
  });

  it("rejects account deletion with an incorrect current password", async () => {
    authMocks.verifyAccessToken.mockResolvedValue({ userId: "user-123", sessionVersion: 0 });
    authMocks.comparePassword.mockResolvedValue(false);
    vi.mocked(db.user.findUnique)
      .mockResolvedValueOnce({
        id: "user-123",
        accountStatus: "ACTIVE",
        sessionVersion: 0,
        emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      } as never)
      .mockResolvedValueOnce({
        id: "user-123",
        passwordHash: "stored-password-hash",
        email: "suhail@example.com",
        accountStatus: "ACTIVE",
      } as never);

    const response = await request(app)
      .delete("/api/v1/auth/me")
      .set("Authorization", "Bearer access-token")
      .send({ currentPassword: "wrong-password" });

    expect(response.status).toBe(401);
    expect(authMocks.enqueueAccountDeletionJob).not.toHaveBeenCalled();
  });

  it("handles unexpected account deletion errors generically", async () => {
    authMocks.verifyAccessToken.mockResolvedValue({ userId: "user-123", sessionVersion: 0 });
    vi.mocked(db.user.findUnique)
      .mockResolvedValueOnce({
        id: "user-123",
        accountStatus: "ACTIVE",
        sessionVersion: 0,
        emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      } as never)
      .mockRejectedValueOnce(new Error("Database unavailable"));

    const response = await request(app)
      .delete("/api/v1/auth/me")
      .set("Authorization", "Bearer access-token")
      .send({ currentPassword: "current-password" });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      message: "Internal server error",
    });
    expect(response.text).not.toContain("Database unavailable");
  });

  it("returns a storage health response without crashing", async () => {
    vi.mocked(checkStorageConnection).mockResolvedValue(undefined);

    const response = await request(app).get("/api/v1/storage/health");

    expect([200, 204]).toContain(response.status);
    expect(checkStorageConnection).toHaveBeenCalledOnce();
  });

  it("includes security headers from Helmet", async () => {
    const response = await request(app).get("/");

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBeDefined();
  });

  it("allows the configured frontend origin", async () => {
    const configuredOrigin =
      process.env.FRONTEND_URL?.split(",")[0]?.trim() ??
      "http://localhost:3000";

    const response = await request(app)
      .get("/api/v1")
      .set("Origin", configuredOrigin);

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      configuredOrigin,
    );
  });

  it("does not grant CORS access to an unconfigured origin", async () => {
    const response = await request(app)
      .get("/api/v1")
      .set("Origin", "https://untrusted-example.invalid");

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rate-limits repeated password-change attempts", async () => {
    const responses = [];

    for (let attempt = 0; attempt < 12; attempt += 1) {
      responses.push(
        await request(app)
          .patch("/api/v1/auth/password")
          .set("Authorization", "Bearer invalid-token")
          .send({
            currentPassword: "current-password",
            newPassword: "new-password",
          }),
      );
    }

    const limitedResponse = responses.find((response) => response.status === 429);

    expect(limitedResponse).toBeDefined();
    expect(limitedResponse?.body).toEqual({
      success: false,
      message: "Too many authentication attempts. Please try again in 15 minutes.",
    });
  });

  it("attaches a generated X-Request-ID header to responses when omitted", async () => {
    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toBeDefined();
    expect(response.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("preserves a valid incoming X-Request-ID header", async () => {
    const customId = "req-custom-trace-12345";
    const response = await request(app)
      .get("/")
      .set("X-Request-ID", customId);

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toBe(customId);
  });

  it("sanitizes an invalid or overly long incoming X-Request-ID header", async () => {
    const overlyLongId = "a".repeat(200);
    const response = await request(app)
      .get("/")
      .set("X-Request-ID", overlyLongId);

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).not.toBe(overlyLongId);
    expect(response.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
