import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "../config/database.js";
import { deleteObject, validateStorageVersioning } from "./storageService.js";
import { AppError } from "../utils/AppError.js";
import { withPendingAccountLock } from "./accountLifecycleService.js";
import { processStorageObjectTask } from "./storageObjectTaskService.js";

const ACCOUNT_DELETION_LEASE_MS = 5 * 60 * 1000;
const ACCOUNT_DELETION_HEARTBEAT_MS = 60 * 1000;
const ACCOUNT_DELETION_RETRY_BASE_MS = 5 * 1000;
const ACCOUNT_DELETION_RETRY_MAX_MS = 60 * 60 * 1000;
const MAX_ACCOUNT_DELETION_ATTEMPTS = 10;

const storageKeyPrefix = (userId: string): string => `${userId}/`;

const validateStorageKey = (userId: string, storageKey: string): void => {
  const prefix = storageKeyPrefix(userId);

  if (
    !storageKey.startsWith(prefix) ||
    storageKey.length === prefix.length ||
    storageKey.includes("..") ||
    storageKey.includes("\\") ||
    /[\u0000-\u001f]/.test(storageKey)
  ) {
    throw new AppError(
      "Account storage key validation failed",
      500,
      false,
    );
  }
};

export const ensureAccountDeletionTask = async (userId: string): Promise<void> => {
  await prisma.accountDeletionTask.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
};

export const requestAccountDeletion = async ({
  userId,
  currentPassword,
}: {
  userId: string;
  currentPassword: string;
}): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      accountStatus: true,
    },
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  if (user.accountStatus === "PENDING_DELETION") {
    throw new AppError("Account deletion is already pending", 409);
  }

  const passwordMatches = await bcrypt.compare(
    currentPassword,
    user.passwordHash,
  );

  if (!passwordMatches) {
    throw new AppError("Current password is incorrect", 401);
  }

  const normalizedEmail = user.email.trim().toLowerCase();
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const transition = await tx.user.updateMany({
      where: {
        id: userId,
        accountStatus: "ACTIVE",
      },
      data: {
        accountStatus: "PENDING_DELETION",
        deletionRequestedAt: now,
      },
    });

    if (transition.count !== 1) {
      throw new AppError("Account deletion is already pending", 409);
    }

    await tx.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });

    // Revoke outgoing links immediately, including public links.
    await tx.shareLink.updateMany({
      where: { createdById: userId, revokedAt: null },
      data: { revokedAt: now },
    });

    // Remove recipient-specific shares regardless of whether the relation was
    // normalized into sharedWithId or retained only as an email address.
    await tx.shareLink.deleteMany({
      where: {
        OR: [
          { sharedWithId: userId },
          { sharedWithEmail: normalizedEmail },
        ],
      },
    });

    await tx.accountDeletionTask.upsert({
      where: { userId },
      create: { userId },
      update: {
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: now,
        leaseUntil: null,
        claimToken: null,
      },
    });
  });
};

export interface AccountDeletionJobData {
  userId: string;
}

export const claimAccountDeletionTask = async (
  userId: string,
): Promise<string | null> => {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + ACCOUNT_DELETION_LEASE_MS);
  const claimToken = randomUUID();

  return prisma.$transaction(async (tx) => {
    // Claiming and finalization both lock the lifecycle row first.
    const lockedRows = await tx.$executeRaw`
      UPDATE "User"
      SET "id" = "id"
      WHERE "id" = ${userId}
        AND "accountStatus" = 'PENDING_DELETION'
    `;

    if (lockedRows !== 1) return null;

    const result = await tx.accountDeletionTask.updateMany({
      where: {
        userId,
        nextAttemptAt: { lte: now },
        OR: [
          { status: "PENDING" },
          { status: "PROCESSING", leaseUntil: { lt: now } },
        ],
      },
      data: {
        status: "PROCESSING",
        leaseUntil,
        claimToken,
        attempts: { increment: 1 },
      },
    });

    return result.count === 1 ? claimToken : null;
  });
};

export const extendAccountDeletionLease = async (
  userId: string,
  claimToken: string,
): Promise<boolean> => {
  const result = await prisma.accountDeletionTask.updateMany({
    where: { userId, status: "PROCESSING", claimToken },
    data: {
      leaseUntil: new Date(Date.now() + ACCOUNT_DELETION_LEASE_MS),
    },
  });

  return result.count === 1;
};

export const recordAccountDeletionFailure = async (
  userId: string,
  claimToken: string,
  failure: unknown,
): Promise<void> => {
  const task = await prisma.accountDeletionTask.findFirst({
    where: { userId, status: "PROCESSING", claimToken },
    select: { attempts: true },
  });

  if (!task) return;

  const failureCode = getAccountDeletionFailureCode(failure);
  const failedAt = new Date();

  if (task.attempts >= MAX_ACCOUNT_DELETION_ATTEMPTS) {
    const updated = await prisma.$executeRaw`
      UPDATE "AccountDeletionTask"
      SET "status" = 'FAILED',
          "claimToken" = NULL,
          "leaseUntil" = NULL,
          "lastFailureCode" = ${failureCode},
          "lastFailureAt" = ${failedAt},
          "failedAt" = ${failedAt},
          "updatedAt" = ${failedAt}
      WHERE "userId" = ${userId}
        AND "status" = 'PROCESSING'
        AND "claimToken" = ${claimToken}
    `;
    if (updated === 1) {
      console.error(
        `[AccountDeletion] Cleanup escalated for user ${userId} after ${task.attempts} attempts`,
      );
    }
    return;
  }

  const delay = Math.min(
    ACCOUNT_DELETION_RETRY_MAX_MS,
    ACCOUNT_DELETION_RETRY_BASE_MS * 2 ** Math.min(task.attempts - 1, 10),
  );

  await prisma.accountDeletionTask.updateMany({
    where: { userId, status: "PROCESSING", claimToken },
    data: {
      status: "PENDING",
      claimToken: null,
      leaseUntil: null,
      nextAttemptAt: new Date(Date.now() + delay),
      lastFailureCode: failureCode,
      lastFailureAt: failedAt,
    },
  });
};

const getAccountDeletionFailureCode = (failure: unknown): string => {
  const message = failure instanceof AppError ? failure.message : "";
  const knownCodes: Readonly<Record<string, string>> = {
    "Account storage cleanup could not be completed": "STORAGE_CLEANUP_FAILED",
    "Account deletion lease was lost": "LEASE_LOST",
    "Account deletion state changed": "ACCOUNT_STATE_CHANGED",
    "Account upload cleanup is still in progress": "UPLOAD_CLEANUP_PENDING",
    "Object storage versioning status could not be established":
      "STORAGE_CONFIGURATION_UNAVAILABLE",
    "Account storage key validation failed": "STORAGE_KEY_VALIDATION_FAILED",
    "Object storage is not configured; versioning cannot be validated":
      "STORAGE_CONFIGURATION_UNAVAILABLE",
    "Account deletion requires object-storage versioning to be disabled":
      "STORAGE_VERSIONING_ENABLED",
  };
  return knownCodes[message] ?? "INTERNAL_ERROR";
};

export const listFailedAccountDeletions = async () =>
  prisma.accountDeletionTask.findMany({
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

export const requeueFailedAccountDeletion = async (
  userId: string,
): Promise<void> => {
  const updated = await prisma.$executeRaw`
    UPDATE "AccountDeletionTask" AS task
    SET "status" = 'PENDING',
        "attempts" = 0,
        "nextAttemptAt" = NOW(),
        "leaseUntil" = NULL,
        "claimToken" = NULL,
        "failedAt" = NULL,
        "updatedAt" = NOW()
    FROM "User" AS account
    WHERE task."userId" = ${userId}
      AND task."status" = 'FAILED'
      AND account."id" = task."userId"
      AND account."accountStatus" = 'PENDING_DELETION'
  `;
  if (updated !== 1) {
    const alreadyRequeued = await prisma.accountDeletionTask.findFirst({
      where: {
        userId,
        status: "PENDING",
        user: { accountStatus: "PENDING_DELETION" },
      },
      select: { userId: true },
    });
    if (alreadyRequeued) return;

    throw new AppError(
      "No failed deletion task exists for this pending account",
      409,
    );
  }
};

const startLeaseHeartbeat = (userId: string, claimToken: string) => {
  let leaseLost = false;
  const timer = setInterval(() => {
    extendAccountDeletionLease(userId, claimToken)
      .then((extended) => {
        if (!extended) leaseLost = true;
      })
      .catch((error) => {
        leaseLost = true;
        console.error("[AccountDeletion] Lease heartbeat failed:", error);
      });
  }, ACCOUNT_DELETION_HEARTBEAT_MS);

  timer.unref();

  return {
    isLost: () => leaseLost,
    stop: () => clearInterval(timer),
  };
};

interface PendingInventory {
  email: string;
  cleanupTaskCount: number;
  activeUploadCount: number;
}

const loadPendingInventory = async (
  userId: string,
): Promise<PendingInventory | null> =>
  withPendingAccountLock(userId, async (tx) => {
    const now = new Date();

    await tx.storageObjectTask.updateMany({
      where: {
        userId,
        status: "UPLOADING",
        leaseUntil: { lt: now },
      },
      data: {
        status: "PENDING_CLEANUP",
        leaseUntil: null,
        nextAttemptAt: now,
      },
    });

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        accountStatus: true,
      },
    });

    if (!user || user.accountStatus !== "PENDING_DELETION") return null;

    const [cleanupTaskCount, activeUploadCount] = await Promise.all([
      tx.storageObjectTask.count({
        where: {
          userId,
          status: { in: ["PENDING_CLEANUP", "PROCESSING"] },
        },
      }),
      tx.storageObjectTask.count({
        where: { userId, status: "UPLOADING" },
      }),
    ]);

    return {
      email: user.email.trim().toLowerCase(),
      cleanupTaskCount,
      activeUploadCount,
    };
  });

const ACCOUNT_STORAGE_BATCH_SIZE = 100;
const ACCOUNT_STORAGE_DELETE_CONCURRENCY = 5;

const deleteStorageBatch = async (
  userId: string,
  storageKeys: string[],
  isLeaseLost: () => boolean,
): Promise<number> => {
  for (const storageKey of storageKeys) {
    validateStorageKey(userId, storageKey);
  }

  let nextIndex = 0;
  let deletedCount = 0;
  let failed = false;
  const workerCount = Math.min(
    ACCOUNT_STORAGE_DELETE_CONCURRENCY,
    storageKeys.length,
  );

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (!failed) {
        if (isLeaseLost()) {
          failed = true;
          return;
        }

        const index = nextIndex++;
        if (index >= storageKeys.length) return;

        try {
          await deleteObject(storageKeys[index]!);
          deletedCount += 1;
        } catch {
          failed = true;
        }
      }
    }),
  );

  if (failed) {
    throw new AppError("Account storage cleanup could not be completed", 503);
  }

  return deletedCount;
};

const deleteOwnedStorageObjects = async (
  userId: string,
  isLeaseLost: () => boolean,
): Promise<number> => {
  let deletedCount = 0;

  const deletePages = async <T extends { id: string; storageKey: string }>(
    findPage: (cursor?: string) => Promise<T[]>,
  ): Promise<void> => {
    let cursor: string | undefined;
    for (;;) {
      const page = await findPage(cursor);
      if (page.length === 0) return;
      deletedCount += await deleteStorageBatch(
        userId,
        page.map(({ storageKey }) => storageKey),
        isLeaseLost,
      );
      cursor = page[page.length - 1]!.id;
    }
  };

  await deletePages((cursor) =>
    prisma.file.findMany({
      where: { ownerId: userId },
      orderBy: { id: "asc" },
      take: ACCOUNT_STORAGE_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, storageKey: true },
    }),
  );

  await deletePages((cursor) =>
    prisma.fileVersion.findMany({
      where: { file: { ownerId: userId } },
      orderBy: { id: "asc" },
      take: ACCOUNT_STORAGE_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, storageKey: true },
    }),
  );

  await processPendingStorageTasks(userId, isLeaseLost, (count) => {
    deletedCount += count;
  });

  return deletedCount;
};

const processPendingStorageTasks = async (
  userId: string,
  isLeaseLost: () => boolean,
  onDeleted: (count: number) => void,
): Promise<void> => {
  let lastId: string | undefined;
  for (;;) {
    const now = new Date();
    const tasks = await prisma.storageObjectTask.findMany({
      where: {
        userId,
        ...(lastId ? { id: { gt: lastId } } : {}),
        nextAttemptAt: { lte: now },
        OR: [
          { status: "PENDING_CLEANUP" },
          { status: "PROCESSING", leaseUntil: { lt: now } },
        ],
      },
      orderBy: { id: "asc" },
      take: ACCOUNT_STORAGE_BATCH_SIZE,
      select: { id: true },
    });

    if (tasks.length === 0) return;

    for (const task of tasks) {
      if (isLeaseLost()) {
        throw new AppError("Account deletion lease was lost", 409);
      }

      if (await processStorageObjectTask(task.id)) {
        onDeleted(1);
      }
    }

    lastId = tasks[tasks.length - 1]!.id;
  }
};

const finalizePendingAccountDeletion = async (
  userId: string,
  normalizedEmail: string,
  claimToken: string,
): Promise<void> => {
  const finalized = await withPendingAccountLock(userId, async (tx) => {
    const task = await tx.accountDeletionTask.findFirst({
      where: { userId, status: "PROCESSING", claimToken },
      select: { id: true },
    });

    if (!task) return false;

    const unresolvedStorageTasks = await tx.storageObjectTask.count({
      where: { userId },
    });

    if (unresolvedStorageTasks !== 0) return false;

    await tx.shareLink.deleteMany({
      where: {
        OR: [
          { sharedWithId: userId },
          { sharedWithEmail: normalizedEmail },
        ],
      },
    });
    await tx.user.delete({ where: { id: userId } });
    return true;
  });

  if (finalized !== true) {
    throw new AppError("Account deletion state changed", 409);
  }
};

export const processAccountDeletionJob = async ({
  userId,
}: AccountDeletionJobData): Promise<{
  deleted: boolean;
  storageKeysDeleted: number;
}> => {
  await validateStorageVersioning({ requireConfigured: true });

  const claimToken = await claimAccountDeletionTask(userId);
  if (!claimToken) return { deleted: false, storageKeysDeleted: 0 };

  const heartbeat = startLeaseHeartbeat(userId, claimToken);

  try {
    const initialInventory = await loadPendingInventory(userId);

    if (!initialInventory) {
      await prisma.accountDeletionTask.deleteMany({
        where: { userId, status: "PROCESSING", claimToken },
      });
      return { deleted: false, storageKeysDeleted: 0 };
    }

    let deletedCount = await deleteOwnedStorageObjects(
      userId,
      heartbeat.isLost,
    );

    const finalInventory = await loadPendingInventory(userId);
    if (!finalInventory) {
      throw new AppError("Account deletion state changed", 409);
    }

    if (finalInventory.cleanupTaskCount > 0) {
      await processPendingStorageTasks(
        userId,
        heartbeat.isLost,
        (count) => {
          deletedCount += count;
        },
      );
    }

    if (finalInventory.activeUploadCount !== 0) {
      throw new AppError("Account upload cleanup is still in progress", 409);
    }

    if (heartbeat.isLost()) {
      throw new AppError("Account deletion lease was lost", 409);
    }

    await finalizePendingAccountDeletion(
      userId,
      finalInventory.email,
      claimToken,
    );

    return { deleted: true, storageKeysDeleted: deletedCount };
  } catch (error) {
    try {
      await recordAccountDeletionFailure(userId, claimToken, error);
    } catch (recordError) {
      console.error(
        "[AccountDeletion] Could not persist retry state:",
        recordError,
      );
    }
    throw error;
  } finally {
    heartbeat.stop();
  }
};
