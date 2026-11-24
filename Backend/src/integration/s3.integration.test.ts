import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../config/database.js";
import {
  processAccountDeletionJob,
  requestAccountDeletion,
} from "../services/accountDeletionService.js";
import {
  checkStorageConnection,
  deleteObject,
  downloadObject,
  uploadObject,
} from "../services/storageService.js";
import {
  TEST_PASSWORD,
  cleanupTestState,
  createStoredFile,
  createStoredVersion,
  createTestUser,
} from "./testHelpers.js";

const configuredBucket = process.env.S3_BUCKET;

if (!configuredBucket) {
  throw new Error("S3_BUCKET must be set by the integration test runner");
}

describe("S3-compatible account-deletion cleanup", () => {
  beforeAll(async () => {
    await checkStorageConnection();
  });

  afterEach(async () => {
    process.env.S3_BUCKET = configuredBucket;
    await cleanupTestState();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("deletes objects idempotently, including missing objects", async () => {
    const key = `integration-direct/${Date.now()}`;
    await uploadObject({
      key,
      body: Buffer.from("delete me"),
      contentType: "text/plain",
    });

    await deleteObject(key);
    await expect(deleteObject(key)).resolves.toBeUndefined();
    await expect(downloadObject(key)).rejects.toBeDefined();
  });

  it("retries account cleanup after the storage provider is unavailable", async () => {
    const owner = await createTestUser();
    const file = await createStoredFile(owner.id);
    await createStoredVersion(owner.id, file.id, 1);

    await requestAccountDeletion({
      userId: owner.id,
      currentPassword: TEST_PASSWORD,
    });

    process.env.S3_BUCKET = `${configuredBucket}-unavailable-${Date.now()}`;
    await expect(
      processAccountDeletionJob({ userId: owner.id }),
    ).rejects.toBeDefined();

    await expect(
      prisma.user.findUnique({
        where: { id: owner.id },
        select: { accountStatus: true },
      }),
    ).resolves.toEqual({ accountStatus: "PENDING_DELETION" });

    process.env.S3_BUCKET = configuredBucket;
    await prisma.accountDeletionTask.update({
      where: { userId: owner.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });

    await expect(
      processAccountDeletionJob({ userId: owner.id }),
    ).resolves.toMatchObject({ deleted: true });
    await expect(
      prisma.user.findUnique({ where: { id: owner.id } }),
    ).resolves.toBeNull();
  });
});
