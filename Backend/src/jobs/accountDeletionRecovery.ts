import { prisma } from "../config/database.js";
import {
  enqueueAccountDeletionJob,
} from "./queues.js";
import {
  ensureAccountDeletionTask,
  processAccountDeletionJob,
} from "../services/accountDeletionService.js";
import { recoverStorageObjectTasks } from "../services/storageObjectTaskService.js";

const ACCOUNT_DELETION_RECOVERY_INTERVAL_MS = 60 * 1000;

export const recoverPendingAccountDeletions = async (): Promise<void> => {
  try {
    await recoverStorageObjectTasks();
  } catch (error) {
    console.error("[StorageCleanup] Recovery scan failed:", error);
  }

  const pendingUsers = await prisma.user.findMany({
    where: { accountStatus: "PENDING_DELETION" },
    select: { id: true },
  });

  for (const { id } of pendingUsers) {
    try {
      await ensureAccountDeletionTask(id);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.error(JSON.stringify({
        event: "account_deletion_task_recovery_failed",
        userId: id,
        errorName,
      }));
    }
  }

  const now = new Date();
  const dueTasks = await prisma.accountDeletionTask.findMany({
    where: {
      nextAttemptAt: { lte: now },
      OR: [
        { status: "PENDING" },
        { status: "PROCESSING", leaseUntil: { lt: now } },
      ],
      user: { accountStatus: "PENDING_DELETION" },
    },
    select: { userId: true },
  });

  for (const { userId } of dueTasks) {
    let queued = false;
    try {
      queued = await enqueueAccountDeletionJob(userId);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.error(JSON.stringify({
        event: "account_deletion_enqueue_failed",
        userId,
        errorName,
      }));
    }
    if (!queued) {
      try {
        // This is a synchronous best-effort fallback only after the durable
        // task exists. A crash leaves it recoverable on the next scan.
        await processAccountDeletionJob({ userId });
      } catch (error) {
        const errorName = error instanceof Error ? error.name : "UnknownError";
        console.error(JSON.stringify({
          event: "account_deletion_inline_recovery_failed",
          userId,
          errorName,
        }));
      }
    }
  }
};

export const startAccountDeletionRecovery = (): NodeJS.Timeout => {
  const runRecovery = () => {
    recoverPendingAccountDeletions().catch((error) => {
      console.error("[AccountDeletion] Recovery scan failed:", error);
    });
  };

  runRecovery();
  const timer = setInterval(runRecovery, ACCOUNT_DELETION_RECOVERY_INTERVAL_MS);
  timer.unref();
  return timer;
};
