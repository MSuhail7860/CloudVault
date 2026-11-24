import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUniqueUser: vi.fn(),
  updateUserMany: vi.fn(),
  deleteUser: vi.fn(),
  findUniqueTransactionUser: vi.fn(),
  updateRefreshTokens: vi.fn(),
  deleteIncomingShares: vi.fn(),
  revokeOutgoingShares: vi.fn(),
  upsertDeletionTask: vi.fn(),
  updateDeletionTask: vi.fn(),
  findDeletionTask: vi.fn(),
  findFailedDeletionTasks: vi.fn(),
  deleteDeletionTask: vi.fn(),
  updateStorageTask: vi.fn(),
  findStorageTasks: vi.fn(),
  deleteStorageTasks: vi.fn(),
  countStorageTasks: vi.fn(),
  findOwnedFiles: vi.fn(),
  findOwnedVersions: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  comparePassword: vi.fn(),
  deleteObject: vi.fn(),
  processStorageTask: vi.fn(),
  validateStorageVersioning: vi.fn(),
}));

vi.mock("bcrypt", () => ({
  default: {
    compare: mocks.comparePassword,
  },
}));

vi.mock("../../config/database.js", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUniqueUser,
    },
    refreshToken: {
      updateMany: mocks.updateRefreshTokens,
    },
    shareLink: {
      deleteMany: mocks.deleteIncomingShares,
      updateMany: mocks.revokeOutgoingShares,
    },
    accountDeletionTask: {
      findMany: mocks.findFailedDeletionTasks,
      updateMany: mocks.updateDeletionTask,
      findFirst: mocks.findDeletionTask,
      deleteMany: mocks.deleteDeletionTask,
      upsert: mocks.upsertDeletionTask,
    },
    storageObjectTask: {
      updateMany: mocks.updateStorageTask,
      findMany: mocks.findStorageTasks,
      deleteMany: mocks.deleteStorageTasks,
      count: mocks.countStorageTasks,
    },
    file: {
      findMany: mocks.findOwnedFiles,
    },
    fileVersion: {
      findMany: mocks.findOwnedVersions,
    },
    $executeRaw: mocks.executeRaw,
    $transaction: mocks.transaction,
  },
}));

vi.mock("../storageService.js", () => ({
  deleteObject: mocks.deleteObject,
  validateStorageVersioning: mocks.validateStorageVersioning,
}));

vi.mock("../storageObjectTaskService.js", () => ({
  processStorageObjectTask: mocks.processStorageTask,
}));

import {
  claimAccountDeletionTask,
  listFailedAccountDeletions,
  processAccountDeletionJob,
  recordAccountDeletionFailure,
  requeueFailedAccountDeletion,
  requestAccountDeletion,
} from "../accountDeletionService.js";
import { AppError } from "../../utils/AppError.js";

const makeTransaction = () => ({
  user: {
    updateMany: mocks.updateUserMany,
    findUnique: mocks.findUniqueTransactionUser,
    delete: mocks.deleteUser,
  },
  refreshToken: {
    updateMany: mocks.updateRefreshTokens,
  },
  shareLink: {
    deleteMany: mocks.deleteIncomingShares,
    updateMany: mocks.revokeOutgoingShares,
  },
  accountDeletionTask: {
    upsert: mocks.upsertDeletionTask,
    updateMany: mocks.updateDeletionTask,
    findFirst: mocks.findDeletionTask,
    deleteMany: mocks.deleteDeletionTask,
  },
  storageObjectTask: {
    updateMany: mocks.updateStorageTask,
    findMany: mocks.findStorageTasks,
    deleteMany: mocks.deleteStorageTasks,
    count: mocks.countStorageTasks,
  },
  $executeRaw: mocks.executeRaw,
});

beforeEach(() => {
  vi.resetAllMocks();

  mocks.transaction.mockImplementation(
    async (callback: (tx: ReturnType<typeof makeTransaction>) => Promise<unknown>) =>
      callback(makeTransaction()),
  );
  mocks.updateUserMany.mockResolvedValue({ count: 1 });
  mocks.updateRefreshTokens.mockResolvedValue({ count: 2 });
  mocks.findUniqueTransactionUser.mockImplementation(() =>
    mocks.findUniqueUser(),
  );
  mocks.deleteObject.mockResolvedValue(undefined);
  mocks.processStorageTask.mockResolvedValue(true);
  mocks.validateStorageVersioning.mockResolvedValue("DISABLED");
  mocks.deleteIncomingShares.mockResolvedValue({ count: 1 });
  mocks.revokeOutgoingShares.mockResolvedValue({ count: 1 });
  mocks.upsertDeletionTask.mockResolvedValue({ userId: "user-123" });
  mocks.updateDeletionTask.mockResolvedValue({ count: 1 });
  mocks.updateStorageTask.mockResolvedValue({ count: 0 });
  mocks.findStorageTasks.mockResolvedValue([]);
  mocks.deleteStorageTasks.mockResolvedValue({ count: 0 });
  mocks.countStorageTasks.mockResolvedValue(0);
  mocks.findOwnedFiles.mockResolvedValue([]);
  mocks.findOwnedVersions.mockResolvedValue([]);
  mocks.findDeletionTask.mockResolvedValue({
    attempts: 1,
    status: "PROCESSING",
  });
  mocks.deleteDeletionTask.mockResolvedValue({ count: 1 });
  mocks.executeRaw.mockResolvedValue(1);
  mocks.deleteUser.mockResolvedValue({ id: "user-123" });
});

describe("requestAccountDeletion", () => {
  it("verifies the password, marks the account pending, and revokes tokens transactionally", async () => {
    mocks.findUniqueUser.mockResolvedValue({
      id: "user-123",
      email: "user@example.com",
      passwordHash: "stored-hash",
      accountStatus: "ACTIVE",
    });
    mocks.comparePassword.mockResolvedValue(true);

    await requestAccountDeletion({
      userId: "user-123",
      currentPassword: "current-password",
    });

    expect(mocks.comparePassword).toHaveBeenCalledWith(
      "current-password",
      "stored-hash",
    );
    expect(mocks.updateUserMany).toHaveBeenCalledWith({
      where: { id: "user-123", accountStatus: "ACTIVE" },
      data: {
        accountStatus: "PENDING_DELETION",
        deletionRequestedAt: expect.any(Date),
      },
    });
    expect(mocks.updateRefreshTokens).toHaveBeenCalledWith({
      where: { userId: "user-123", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mocks.revokeOutgoingShares).toHaveBeenCalledWith({
      where: { createdById: "user-123", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mocks.deleteIncomingShares).toHaveBeenCalledWith({
      where: {
        OR: [
          { sharedWithId: "user-123" },
          { sharedWithEmail: "user@example.com" },
        ],
      },
    });
    expect(mocks.upsertDeletionTask).toHaveBeenCalledWith({
      where: { userId: "user-123" },
      create: { userId: "user-123" },
      update: expect.objectContaining({ status: "PENDING" }),
    });
  });

  it("rejects an incorrect current password", async () => {
    mocks.findUniqueUser.mockResolvedValue({
      id: "user-123",
      email: "user@example.com",
      passwordHash: "stored-hash",
      accountStatus: "ACTIVE",
    });
    mocks.comparePassword.mockResolvedValue(false);

    await expect(
      requestAccountDeletion({
        userId: "user-123",
        currentPassword: "wrong-password",
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      message: "Current password is incorrect",
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("handles duplicate deletion requests safely", async () => {
    mocks.findUniqueUser.mockResolvedValue({
      id: "user-123",
      email: "user@example.com",
      passwordHash: "stored-hash",
      accountStatus: "PENDING_DELETION",
    });

    await expect(
      requestAccountDeletion({
        userId: "user-123",
        currentPassword: "current-password",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Account deletion is already pending",
    });

    expect(mocks.comparePassword).not.toHaveBeenCalled();
  });

  it("does not mark the account pending when the database transaction fails", async () => {
    mocks.findUniqueUser.mockResolvedValue({
      id: "user-123",
      email: "user@example.com",
      passwordHash: "stored-hash",
      accountStatus: "ACTIVE",
    });
    mocks.comparePassword.mockResolvedValue(true);
    const error = new Error("Database unavailable");
    mocks.transaction.mockRejectedValue(error);

    await expect(
      requestAccountDeletion({
        userId: "user-123",
        currentPassword: "current-password",
      }),
    ).rejects.toBe(error);
  });
});

describe("processAccountDeletionJob", () => {
  it("deletes active and trashed files, historical versions, incoming shares, and the user", async () => {
    mocks.findUniqueUser.mockResolvedValue({
      id: "user-123",
      email: "user@example.com",
      accountStatus: "PENDING_DELETION",
    });
    mocks.findOwnedFiles
      .mockResolvedValueOnce([
        { id: "file-a", storageKey: "user-123/current-a" },
        { id: "file-b", storageKey: "user-123/trashed-file" },
      ])
      .mockResolvedValue([]);
    mocks.findOwnedVersions
      .mockResolvedValueOnce([
        { id: "version-a", storageKey: "user-123/version-a" },
        { id: "version-b", storageKey: "user-123/version-b" },
      ])
      .mockResolvedValue([]);

    const result = await processAccountDeletionJob({ userId: "user-123" });

    expect(result).toEqual({
      deleted: true,
      storageKeysDeleted: 4,
    });
    expect(mocks.deleteObject).toHaveBeenCalledTimes(4);
    expect(mocks.deleteObject).toHaveBeenCalledWith("user-123/current-a");
    expect(mocks.deleteObject).toHaveBeenCalledWith("user-123/trashed-file");
    expect(mocks.deleteObject).toHaveBeenCalledWith("user-123/version-a");
    expect(mocks.deleteObject).toHaveBeenCalledWith("user-123/version-b");
    expect(mocks.deleteIncomingShares).toHaveBeenCalledWith({
      where: {
        OR: [
          { sharedWithId: "user-123" },
          { sharedWithEmail: "user@example.com" },
        ],
      },
    });
    expect(mocks.deleteUser).toHaveBeenCalledWith({
      where: { id: "user-123" },
    });
  });

  it("does not delete another user's storage key", async () => {
    mocks.findUniqueUser.mockResolvedValue({
      id: "user-123",
      email: "user@example.com",
      accountStatus: "PENDING_DELETION",
    });
    mocks.findOwnedFiles.mockResolvedValue([
      { id: "file-a", storageKey: "other-user/file" },
    ]);

    await expect(
      processAccountDeletionJob({ userId: "user-123" }),
    ).rejects.toMatchObject({
      statusCode: 500,
      isOperational: false,
    });

    expect(mocks.deleteObject).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalled();
  });

  it("keeps the account pending when storage deletion fails", async () => {
    mocks.findUniqueUser.mockResolvedValue({
      id: "user-123",
      email: "user@example.com",
      accountStatus: "PENDING_DELETION",
    });
    mocks.findOwnedFiles.mockResolvedValue([
      { id: "file-a", storageKey: "user-123/file" },
    ]);
    mocks.deleteObject.mockRejectedValue(new Error("Storage unavailable"));

    await expect(
      processAccountDeletionJob({ userId: "user-123" }),
    ).rejects.toThrow("Account storage cleanup could not be completed");

    expect(mocks.transaction).toHaveBeenCalled();
  });

  it("does not claim a storage cleanup task while another worker has a live lease", async () => {
    mocks.findUniqueUser.mockResolvedValue({
      id: "user-123",
      email: "user@example.com",
      accountStatus: "PENDING_DELETION",
    });
    mocks.countStorageTasks
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    mocks.findDeletionTask.mockResolvedValue({ id: "task-123" });

    await expect(
      processAccountDeletionJob({ userId: "user-123" }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(mocks.findStorageTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { status: "PENDING_CLEANUP" },
            { status: "PROCESSING", leaseUntil: { lt: expect.any(Date) } },
          ],
        }),
      }),
    );
    expect(mocks.processStorageTask).not.toHaveBeenCalled();
    expect(mocks.deleteStorageTasks).not.toHaveBeenCalled();
  });

  it("leaves the account pending when the final database transaction fails", async () => {
    mocks.findUniqueUser.mockResolvedValue({
      id: "user-123",
      email: "user@example.com",
      accountStatus: "PENDING_DELETION",
    });
    mocks.findOwnedFiles.mockResolvedValueOnce([
      { id: "file-a", storageKey: "user-123/file" },
    ]).mockResolvedValue([]);
    const error = new Error("Database unavailable");
    mocks.transaction
      .mockImplementationOnce(
        async (callback: (tx: ReturnType<typeof makeTransaction>) => Promise<unknown>) =>
          callback(makeTransaction()),
      )
      .mockImplementationOnce(
        async (callback: (tx: ReturnType<typeof makeTransaction>) => Promise<unknown>) =>
          callback(makeTransaction()),
      )
      .mockRejectedValueOnce(error);

    await expect(
      processAccountDeletionJob({ userId: "user-123" }),
    ).rejects.toBe(error);

    expect(mocks.deleteObject).toHaveBeenCalledWith("user-123/file");
  });

  it("is idempotent when the user has already been deleted", async () => {
    mocks.findUniqueUser.mockResolvedValue(null);

    await expect(
      processAccountDeletionJob({ userId: "user-123" }),
    ).resolves.toEqual({ deleted: false, storageKeysDeleted: 0 });

    expect(mocks.deleteObject).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalled();
  });

  it("allows only one concurrent worker to claim a task", async () => {
    mocks.updateDeletionTask
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const [first, second] = await Promise.all([
      claimAccountDeletionTask("user-123"),
      claimAccountDeletionTask("user-123"),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect([first, second].filter((value) => value === null)).toHaveLength(1);
    expect(mocks.updateDeletionTask).toHaveBeenCalledTimes(2);
  });

  it("records retry state with exponential backoff without storing error details", async () => {
    await recordAccountDeletionFailure(
      "user-123",
      "claim-token",
      new Error("password=must-not-be-persisted"),
    );

    expect(mocks.updateDeletionTask).toHaveBeenCalledWith({
      where: {
        userId: "user-123",
        status: "PROCESSING",
        claimToken: "claim-token",
      },
      data: {
        status: "PENDING",
        claimToken: null,
        leaseUntil: null,
        nextAttemptAt: expect.any(Date),
        lastFailureCode: "INTERNAL_ERROR",
        lastFailureAt: expect.any(Date),
      },
    });
    expect(mocks.updateDeletionTask.mock.calls[0]?.[0]).not.toMatchObject({
      data: expect.objectContaining({
        lastFailureCode: "password=must-not-be-persisted",
      }),
    });
  });

  it("escalates tasks after the maximum number of attempts", async () => {
    mocks.findDeletionTask.mockResolvedValue({
      attempts: 10,
      status: "PROCESSING",
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await recordAccountDeletionFailure(
      "user-123",
      "claim-token",
      new Error("provider response secret"),
    );

    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    expect(mocks.executeRaw.mock.calls[0]?.[0]).toBeDefined();
    expect(mocks.updateDeletionTask).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Cleanup escalated for user user-123"),
    );
    errorSpy.mockRestore();
  });

  it("persists a sanitized terminal failure code and timestamps", async () => {
    mocks.findDeletionTask.mockResolvedValue({
      attempts: 10,
      status: "PROCESSING",
    });

    await recordAccountDeletionFailure(
      "user-123",
      "claim-token",
      new AppError("Account storage cleanup could not be completed", 503),
    );

    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    const queryArgs = mocks.executeRaw.mock.calls[0]?.slice(1) ?? [];
    expect(queryArgs).toContain("STORAGE_CLEANUP_FAILED");
    expect(queryArgs).not.toContain("Account storage cleanup could not be completed");
  });

  it("lists only failed pending accounts with sanitized operator metadata", async () => {
    mocks.findFailedDeletionTasks.mockResolvedValue([]);

    await listFailedAccountDeletions();

    expect(mocks.findFailedDeletionTasks).toHaveBeenCalledWith({
      where: {
        status: "FAILED",
        user: { accountStatus: "PENDING_DELETION" },
      },
      orderBy: [{ failedAt: "asc" }, { userId: "asc" }],
      select: {
        userId: true,
        status: true,
        attempts: true,
        createdAt: true,
        updatedAt: true,
        lastFailureCode: true,
        lastFailureAt: true,
        failedAt: true,
        user: {
          select: {
            email: true,
            deletionRequestedAt: true,
            accountStatus: true,
          },
        },
      },
    });
  });

  it("allows an operator to requeue only a failed pending-account task", async () => {
    mocks.executeRaw.mockResolvedValueOnce(0);
    mocks.findDeletionTask.mockResolvedValueOnce({ userId: "user-123" });
    await expect(
      requeueFailedAccountDeletion("user-123"),
    ).resolves.toBeUndefined();
    expect(mocks.executeRaw).toHaveBeenCalledOnce();

    mocks.executeRaw.mockResolvedValue(0);
    mocks.findDeletionTask.mockResolvedValueOnce({ userId: "user-123" });
    await expect(
      requeueFailedAccountDeletion("user-123"),
    ).resolves.toBeUndefined();

    mocks.executeRaw.mockResolvedValue(0);
    mocks.findDeletionTask.mockResolvedValueOnce(null);
    await expect(
      requeueFailedAccountDeletion("user-123"),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "No failed deletion task exists for this pending account",
    });
  });

  it("does not let a stale worker reset a newer claim", async () => {
    mocks.findDeletionTask.mockResolvedValue(null);

    await recordAccountDeletionFailure(
      "user-123",
      "stale-claim",
      new Error("stale worker"),
    );

    expect(mocks.updateDeletionTask).not.toHaveBeenCalled();
  });
});
