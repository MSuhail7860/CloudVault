import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../config/database.js";
import {
  claimAccountDeletionTask,
  processAccountDeletionJob,
  listFailedAccountDeletions,
  recordAccountDeletionFailure,
  requeueFailedAccountDeletion,
  requestAccountDeletion,
} from "../services/accountDeletionService.js";
import { reserveStorageObject } from "../services/storageObjectTaskService.js";
import { AppError } from "../utils/AppError.js";
import { createFolder } from "../services/folderService.js";
import {
  createShareLink,
} from "../services/shareService.js";
import {
  moveFileToTrash,
  renameFile,
  uploadFile,
} from "../services/fileService.js";
import {
  TEST_PASSWORD,
  cleanupTestState,
  createStoredFile,
  createStoredVersion,
  createTestUser,
  deferred,
} from "./testHelpers.js";

describe("account deletion with PostgreSQL and S3", () => {
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  afterEach(async () => {
    await cleanupTestState();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("cleans current, trashed, historical, incoming, and outgoing data", async () => {
    const owner = await createTestUser();
    const recipient = await createTestUser();
    const externalOwner = await createTestUser();
    const currentFile = await createStoredFile(owner.id);
    await createStoredVersion(owner.id, currentFile.id, 1);
    const trashedFile = await createStoredFile(owner.id);
    await createStoredVersion(owner.id, trashedFile.id, 1);

    await prisma.file.update({
      where: { id: trashedFile.id },
      data: { deletedAt: new Date() },
    });

    const externalFile = await createStoredFile(externalOwner.id);
    const outgoingTokenHash = randomUUID();
    const incomingIdTokenHash = randomUUID();
    const incomingEmailTokenHash = randomUUID();

    await prisma.shareLink.createMany({
      data: [
        {
          tokenHash: outgoingTokenHash,
          fileId: currentFile.id,
          createdById: owner.id,
          sharedWithId: recipient.id,
        },
        {
          tokenHash: incomingIdTokenHash,
          fileId: externalFile.id,
          createdById: externalOwner.id,
          sharedWithId: owner.id,
          sharedWithEmail: owner.email,
        },
        {
          tokenHash: incomingEmailTokenHash,
          fileId: externalFile.id,
          createdById: externalOwner.id,
          sharedWithEmail: owner.email,
        },
      ],
    });

    await requestAccountDeletion({
      userId: owner.id,
      currentPassword: TEST_PASSWORD,
    });

    const pending = await prisma.user.findUnique({
      where: { id: owner.id },
      select: { accountStatus: true },
    });
    const outgoing = await prisma.shareLink.findUnique({
      where: { tokenHash: outgoingTokenHash },
      select: { revokedAt: true },
    });
    const incoming = await prisma.shareLink.findMany({
      where: {
        OR: [
          { sharedWithId: owner.id },
          { sharedWithEmail: owner.email },
        ],
      },
    });

    expect(pending?.accountStatus).toBe("PENDING_DELETION");
    expect(outgoing?.revokedAt).not.toBeNull();
    expect(incoming).toHaveLength(0);

    await expect(
      processAccountDeletionJob({ userId: owner.id }),
    ).resolves.toMatchObject({ deleted: true });

    await expect(
      prisma.user.findUnique({ where: { id: owner.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.file.findUnique({ where: { id: currentFile.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.file.findUnique({ where: { id: trashedFile.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.user.findUnique({ where: { id: externalOwner.id } }),
    ).resolves.not.toBeNull();
  });

  it("serializes deletion after an earlier lifecycle lock and blocks later reservations", async () => {
    const owner = await createTestUser();
    const file = await createStoredFile(owner.id);
    const acquired = deferred();
    const release = deferred();

    const firstMutation = prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$executeRaw`
        UPDATE "User" SET "id" = "id"
        WHERE "id" = ${owner.id} AND "accountStatus" = 'ACTIVE'
      `;
      expect(lockedRows).toBe(1);

      await tx.storageObjectTask.create({
        data: {
          userId: owner.id,
          storageKey: file.storageKey,
          status: "UPLOADING",
          leaseUntil: new Date(Date.now() + 30 * 60 * 1000),
        },
      });
      acquired.resolve();
      await release.promise;
    });

    await acquired.promise;
    let deletionSettled = false;
    const deletion = requestAccountDeletion({
      userId: owner.id,
      currentPassword: TEST_PASSWORD,
    }).finally(() => {
      deletionSettled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(deletionSettled).toBe(false);
    release.resolve();
    await firstMutation;
    await deletion;

    await expect(
      reserveStorageObject(owner.id, `${owner.id}/${randomUUID()}`),
    ).rejects.toMatchObject({ statusCode: 401 });

    await prisma.storageObjectTask.updateMany({
      where: { userId: owner.id },
      data: { status: "PENDING_CLEANUP", leaseUntil: null },
    });
    await expect(
      processAccountDeletionJob({ userId: owner.id }),
    ).resolves.toMatchObject({ deleted: true });
  });

  it("allows only one concurrent deletion request to transition the account", async () => {
    const owner = await createTestUser();

    const results = await Promise.allSettled([
      requestAccountDeletion({
        userId: owner.id,
        currentPassword: TEST_PASSWORD,
      }),
      requestAccountDeletion({
        userId: owner.id,
        currentPassword: TEST_PASSWORD,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.status === "rejected" && result.reason?.statusCode === 409,
      ),
    ).toHaveLength(1);
  });

  it("prevents protected mutations while the account is pending", async () => {
    const owner = await createTestUser();
    const file = await createStoredFile(owner.id);

    await requestAccountDeletion({
      userId: owner.id,
      currentPassword: TEST_PASSWORD,
    });

    await expect(
      createFolder({ ownerId: owner.id, name: "blocked-folder" }),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      renameFile({ fileId: file.id, ownerId: owner.id, newName: "blocked.txt" }),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      moveFileToTrash({ fileId: file.id, ownerId: owner.id }),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      createShareLink({ fileId: file.id, ownerId: owner.id }),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      uploadFile({
        ownerId: owner.id,
        originalName: "blocked.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("blocked"),
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("prevents stale workers from resetting a newer claim after lease expiry", async () => {
    const owner = await createTestUser();
    await requestAccountDeletion({
      userId: owner.id,
      currentPassword: TEST_PASSWORD,
    });

    const firstClaim = await claimAccountDeletionTask(owner.id);
    expect(firstClaim).toEqual(expect.any(String));

    await prisma.accountDeletionTask.update({
      where: { userId: owner.id },
      data: {
        leaseUntil: new Date(Date.now() - 1000),
        nextAttemptAt: new Date(Date.now() - 1000),
      },
    });

    const secondClaim = await claimAccountDeletionTask(owner.id);
    expect(secondClaim).toEqual(expect.any(String));
    expect(secondClaim).not.toBe(firstClaim);

    await recordAccountDeletionFailure(owner.id, firstClaim!, new Error("stale worker"));

    await expect(
      prisma.accountDeletionTask.findUnique({
        where: { userId: owner.id },
        select: { status: true, claimToken: true },
      }),
    ).resolves.toEqual({ status: "PROCESSING", claimToken: secondClaim });
  });

  it("escalates exhausted deletion tasks and permits explicit operator requeue", async () => {
    const owner = await createTestUser();
    await requestAccountDeletion({
      userId: owner.id,
      currentPassword: TEST_PASSWORD,
    });

    const claimToken = await claimAccountDeletionTask(owner.id);
    expect(claimToken).toEqual(expect.any(String));
    await prisma.accountDeletionTask.update({
      where: { userId: owner.id },
      data: { attempts: 10 },
    });

    await recordAccountDeletionFailure(
      owner.id,
      claimToken!,
      new AppError("Account storage cleanup could not be completed", 503),
    );
    await expect(
      prisma.accountDeletionTask.findUnique({
        where: { userId: owner.id },
        select: {
          status: true,
          claimToken: true,
          attempts: true,
          lastFailureCode: true,
          lastFailureAt: true,
          failedAt: true,
        },
      }),
    ).resolves.toMatchObject({
      status: "FAILED",
      claimToken: null,
      attempts: 10,
      lastFailureCode: "STORAGE_CLEANUP_FAILED",
      lastFailureAt: expect.any(Date),
      failedAt: expect.any(Date),
    });

    await expect(listFailedAccountDeletions()).resolves.toMatchObject([
      {
        userId: owner.id,
        attempts: 10,
        lastFailureCode: "STORAGE_CLEANUP_FAILED",
        user: { email: owner.email, accountStatus: "PENDING_DELETION" },
      },
    ]);

    await requeueFailedAccountDeletion(owner.id);
    await requeueFailedAccountDeletion(owner.id);
    await expect(
      prisma.accountDeletionTask.findUnique({
        where: { userId: owner.id },
        select: {
          status: true,
          attempts: true,
          failedAt: true,
          lastFailureCode: true,
          lastFailureAt: true,
        },
      }),
    ).resolves.toMatchObject({
      status: "PENDING",
      attempts: 0,
      failedAt: null,
      lastFailureCode: "STORAGE_CLEANUP_FAILED",
      lastFailureAt: expect.any(Date),
    });
    await expect(
      prisma.user.findUnique({
        where: { id: owner.id },
        select: { accountStatus: true },
      }),
    ).resolves.toEqual({ accountStatus: "PENDING_DELETION" });
  });
});
