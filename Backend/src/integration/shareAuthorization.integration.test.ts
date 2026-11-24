import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app.js";
import { prisma } from "../config/database.js";
import { createAccessToken } from "../utils/jwt.js";
import {
  cleanupTestState,
  createStoredFile,
  createTestUser,
} from "./testHelpers.js";

describe("restricted share authorization over HTTP", () => {
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  afterEach(async () => {
    await cleanupTestState();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("limits listing and download to the verified recipient and ignores legacy email-only shares", async () => {
    const owner = await createTestUser();
    const recipient = await createTestUser();
    const wrongRecipient = await createTestUser();
    const file = await createStoredFile(owner.id);
    const verifiedAt = new Date();

    await prisma.user.updateMany({
      where: {
        id: { in: [owner.id, recipient.id, wrongRecipient.id] },
      },
      data: { emailVerifiedAt: verifiedAt },
    });

    const [ownerToken, recipientToken, wrongRecipientToken] =
      await Promise.all([
        createAccessToken(owner.id, 0),
        createAccessToken(recipient.id, 0),
        createAccessToken(wrongRecipient.id, 0),
      ]);

    const created = await request(app)
      .post(`/api/v1/shares/files/${file.id}`)
      .set("Authorization", "Bearer " + ownerToken)
      .send({ sharedWithEmail: recipient.email, permission: "VIEW" });
    expect(created.status).toBe(201);
    const shareId = created.body.data.id as string;

    await prisma.shareLink.create({
      data: {
        tokenHash: randomUUID(),
        fileId: file.id,
        createdById: owner.id,
        permission: "VIEW",
        sharedWithEmail: recipient.email,
        sharedWithId: null,
      },
    });

    const wrongListing = await request(app)
      .get("/api/v1/shares/with-me")
      .set("Authorization", "Bearer " + wrongRecipientToken);
    expect(wrongListing.status).toBe(200);
    expect(wrongListing.body.data).toEqual([]);

    const wrongDownload = await request(app)
      .get(`/api/v1/shares/with-me/${shareId}/download`)
      .set("Authorization", "Bearer " + wrongRecipientToken);
    expect(wrongDownload.status).toBe(404);

    const recipientListing = await request(app)
      .get("/api/v1/shares/with-me")
      .set("Authorization", "Bearer " + recipientToken);
    expect(recipientListing.status).toBe(200);
    expect(recipientListing.body.data).toHaveLength(1);
    expect(recipientListing.body.data[0].id).toBe(shareId);

    const recipientDownload = await request(app)
      .get(`/api/v1/shares/with-me/${shareId}/download`)
      .set("Authorization", "Bearer " + recipientToken);
    expect(recipientDownload.status).toBe(200);
    expect(recipientDownload.text).toBe("CloudVault integration test object");
  });
});
