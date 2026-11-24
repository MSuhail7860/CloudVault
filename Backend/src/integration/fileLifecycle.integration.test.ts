import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app.js";
import { prisma } from "../config/database.js";
import { deleteObject } from "../services/storageService.js";
import { createAccessToken } from "../utils/jwt.js";
import { cleanupTestState, createTestUser } from "./testHelpers.js";

let ownerId: string | undefined;

describe("file lifecycle over HTTP with PostgreSQL and S3", () => {
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  afterEach(async () => {
    if (ownerId) {
      const files = await prisma.file.findMany({
        where: { ownerId },
        select: { storageKey: true },
      });
      for (const { storageKey } of files) {
        await deleteObject(storageKey);
      }
    }
    ownerId = undefined;
    await cleanupTestState();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("uploads, authorizes, trashes, restores, and permanently deletes a file", async () => {
    const owner = await createTestUser();
    const otherUser = await createTestUser();
    ownerId = owner.id;
    const verifiedAt = new Date();
    await prisma.user.updateMany({
      where: { id: { in: [owner.id, otherUser.id] } },
      data: { emailVerifiedAt: verifiedAt },
    });

    const [ownerToken, otherUserToken] = await Promise.all([
      createAccessToken(owner.id, 0),
      createAccessToken(otherUser.id, 0),
    ]);
    const content = Buffer.from("%PDF-1.7\nCloudVault integration content");

    const uploaded = await request(app)
      .post("/api/v1/files/upload")
      .set("Authorization", "Bearer " + ownerToken)
      .attach("file", content, {
        filename: "integration.pdf",
        contentType: "application/pdf",
      });
    expect(uploaded.status).toBe(201);
    const fileId = uploaded.body.data.id as string;

    const wrongOwnerDownload = await request(app)
      .get(`/api/v1/files/${fileId}/download`)
      .set("Authorization", "Bearer " + otherUserToken);
    expect(wrongOwnerDownload.status).toBe(404);

    const downloaded = await request(app)
      .get(`/api/v1/files/${fileId}/download`)
      .set("Authorization", "Bearer " + ownerToken);
    expect(downloaded.status).toBe(200);
    expect(Buffer.from(downloaded.body).equals(content)).toBe(true);

    const trashed = await request(app)
      .delete(`/api/v1/files/${fileId}`)
      .set("Authorization", "Bearer " + ownerToken);
    expect(trashed.status).toBe(200);

    const trashedDownload = await request(app)
      .get(`/api/v1/files/${fileId}/download`)
      .set("Authorization", "Bearer " + ownerToken);
    expect(trashedDownload.status).toBe(404);

    const restored = await request(app)
      .post(`/api/v1/files/${fileId}/restore`)
      .set("Authorization", "Bearer " + ownerToken);
    expect(restored.status).toBe(200);

    const restoredDownload = await request(app)
      .get(`/api/v1/files/${fileId}/download`)
      .set("Authorization", "Bearer " + ownerToken);
    expect(restoredDownload.status).toBe(200);
    expect(Buffer.from(restoredDownload.body).equals(content)).toBe(true);

    const trashedAgain = await request(app)
      .delete(`/api/v1/files/${fileId}`)
      .set("Authorization", "Bearer " + ownerToken);
    expect(trashedAgain.status).toBe(200);

    const deleted = await request(app)
      .delete(`/api/v1/files/${fileId}/permanent`)
      .set("Authorization", "Bearer " + ownerToken);
    expect(deleted.status).toBe(200);
    await expect(
      prisma.file.findUnique({ where: { id: fileId } }),
    ).resolves.toBeNull();
  });
});
