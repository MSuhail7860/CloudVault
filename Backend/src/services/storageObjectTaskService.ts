import { randomUUID } from "node:crypto";
import { prisma } from "../config/database.js";
import { AppError } from "../utils/AppError.js";
import { withActiveAccountLock } from "./accountLifecycleService.js";
import { deleteObject } from "./storageService.js";

const UPLOAD_LEASE_MS = 30 * 60 * 1000;
const CLEANUP_LEASE_MS = 5 * 60 * 1000;
const CLEANUP_HEARTBEAT_MS = 60 * 1000;
const RETRY_BASE_MS = 5 * 1000;
const RETRY_MAX_MS = 60 * 60 * 1000;

export const startStorageObjectReservationHeartbeat = (reservationId: string) => {
  let leaseLost = false;
  const timer = setInterval(() => {
    prisma.storageObjectTask.updateMany({
      where: { id: reservationId, status: "UPLOADING" },
      data: { leaseUntil: new Date(Date.now() + UPLOAD_LEASE_MS) },
    })
      .then((result) => {
        if (result.count !== 1) leaseLost = true;
      })
      .catch((error) => {
        leaseLost = true;
        console.error("[StorageCleanup] Upload reservation heartbeat failed:", error);
      });
  }, 5 * 60 * 1000);

  timer.unref();

  return {
    isLost: () => leaseLost,
    stop: () => clearInterval(timer),
  };
};

export const reserveStorageObject = async (
  userId: string,
  storageKey: string,
): Promise<string> => {
  const reservation = await withActiveAccountLock(userId, (tx) =>
    tx.storageObjectTask.create({
      data: {
        userId,
        storageKey,
        status: "UPLOADING",
        leaseUntil: new Date(Date.now() + UPLOAD_LEASE_MS),
      },
      select: { id: true },
    }),
  );

  return reservation.id;
};

export const startStorageObjectCleanupHeartbeat = (
  taskId: string,
  claimToken: string,
) => {
  let leaseLost = false;
  let stopped = false;

  const extendLease = () => {
    if (stopped) return;

    prisma.storageObjectTask.updateMany({
      where: {
        id: taskId,
        status: "PROCESSING",
        claimToken,
      },
      data: { leaseUntil: new Date(Date.now() + CLEANUP_LEASE_MS) },
    })
      .then((result) => {
        if (result.count !== 1) leaseLost = true;
      })
      .catch((error) => {
        leaseLost = true;
        console.error("[StorageCleanup] Cleanup lease heartbeat failed:", error);
      });
  };

  const timer = setInterval(extendLease, CLEANUP_HEARTBEAT_MS);
  timer.unref();

  return {
    isLost: () => leaseLost,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
};

export const scheduleStorageObjectCleanup = async (
  reservationId: string,
): Promise<void> => {
  await prisma.storageObjectTask.updateMany({
    where: {
      id: reservationId,
      status: "UPLOADING",
    },
    data: {
      status: "PENDING_CLEANUP",
      leaseUntil: null,
      nextAttemptAt: new Date(),
    },
  });
};

export const expireStorageObjectReservations = async (): Promise<void> => {
  await prisma.storageObjectTask.updateMany({
    where: {
      status: "UPLOADING",
      leaseUntil: { lt: new Date() },
    },
    data: {
      status: "PENDING_CLEANUP",
      leaseUntil: null,
      nextAttemptAt: new Date(),
    },
  });
};

const claimStorageObjectTask = async (
  taskId: string,
): Promise<string | null> => {
  const now = new Date();
  const claimToken = randomUUID();
  const result = await prisma.storageObjectTask.updateMany({
    where: {
      id: taskId,
      nextAttemptAt: { lte: now },
      OR: [
        { status: "PENDING_CLEANUP" },
        { status: "PROCESSING", leaseUntil: { lt: now } },
      ],
    },
    data: {
      status: "PROCESSING",
      claimToken,
      leaseUntil: new Date(now.getTime() + CLEANUP_LEASE_MS),
      attempts: { increment: 1 },
    },
  });

  return result.count === 1 ? claimToken : null;
};

const recordStorageObjectTaskFailure = async (
  taskId: string,
  claimToken: string,
): Promise<void> => {
  const task = await prisma.storageObjectTask.findFirst({
    where: {
      id: taskId,
      status: "PROCESSING",
      claimToken,
    },
    select: { attempts: true },
  });

  if (!task) return;

  const delay = Math.min(
    RETRY_MAX_MS,
    RETRY_BASE_MS * 2 ** Math.min(task.attempts - 1, 10),
  );

  await prisma.storageObjectTask.updateMany({
    where: {
      id: taskId,
      status: "PROCESSING",
      claimToken,
    },
    data: {
      status: "PENDING_CLEANUP",
      claimToken: null,
      leaseUntil: null,
      nextAttemptAt: new Date(Date.now() + delay),
    },
  });
};

export const processStorageObjectTask = async (
  taskId: string,
): Promise<boolean> => {
  const claimToken = await claimStorageObjectTask(taskId);
  if (!claimToken) return false;

  const heartbeat = startStorageObjectCleanupHeartbeat(taskId, claimToken);

  try {
    const task = await prisma.storageObjectTask.findFirst({
      where: {
        id: taskId,
        status: "PROCESSING",
        claimToken,
      },
      select: { storageKey: true },
    });

    if (!task) return false;

    await deleteObject(task.storageKey);

    if (heartbeat.isLost()) {
      throw new AppError("Storage cleanup lease was lost", 409);
    }

    const removed = await prisma.storageObjectTask.deleteMany({
      where: {
        id: taskId,
        status: "PROCESSING",
        claimToken,
      },
    });

    if (removed.count !== 1) {
      throw new AppError("Storage cleanup ownership changed", 409);
    }

    return true;
  } catch (error) {
    try {
      await recordStorageObjectTaskFailure(taskId, claimToken);
    } catch (recordError) {
      console.error(
        "[StorageCleanup] Could not persist retry state:",
        recordError,
      );
    }

    throw error;
  } finally {
    heartbeat.stop();
  }
};

export const recoverStorageObjectTasks = async (): Promise<void> => {
  await expireStorageObjectReservations();

  const now = new Date();
  const tasks = await prisma.storageObjectTask.findMany({
    where: {
      nextAttemptAt: { lte: now },
      OR: [
        { status: "PENDING_CLEANUP" },
        { status: "PROCESSING", leaseUntil: { lt: now } },
      ],
    },
    select: { id: true },
  });

  for (const task of tasks) {
    try {
      await processStorageObjectTask(task.id);
    } catch (error) {
      console.error(`[StorageCleanup] Cleanup failed for ${task.id}:`, error);
    }
  }
};
