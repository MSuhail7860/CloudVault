import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../config/database.js", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
    },
  },
}));

vi.mock("../services/storageService.js", () => ({
  checkStorageConnection: vi.fn(),
  uploadObject: vi.fn(),
  downloadObject: vi.fn(),
  deleteObject: vi.fn(),
}));

import app from "../app.js";
import { prisma } from "../config/database.js";
import { checkStorageConnection } from "../services/storageService.js";

const db = vi.mocked(prisma);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("Express application", () => {
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
});