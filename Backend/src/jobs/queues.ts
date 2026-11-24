
import { Queue } from "bullmq";
import { getRedisClient } from "../config/redis.js";
import { processFileJob } from "./processors/fileProcessor.js";
import { processCleanupJob } from "./processors/cleanupProcessor.js";

let fileProcessingQueue: Queue | null = null;
let cleanupQueue: Queue | null = null;
let accountDeletionQueue: Queue | null = null;

export const FILE_PROCESSING_QUEUE_NAME = "file-processing";
export const CLEANUP_QUEUE_NAME = "maintenance-cleanup";
export const ACCOUNT_DELETION_QUEUE_NAME = "account-deletion";

const CLEANUP_SCHEDULER_ID = "expired-share-links-cleanup";
const ACCOUNT_DELETION_RECOVERY_SCHEDULER_ID =
  "pending-account-deletion-recovery";
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Every hour
const ACCOUNT_DELETION_RECOVERY_INTERVAL_MS = 5 * 60 * 1000;
const ACCOUNT_DELETION_ENQUEUE_TIMEOUT_MS = 3000;

export const getFileProcessingQueue = (): Queue | null => {
  if (fileProcessingQueue) return fileProcessingQueue;

  const redis = getRedisClient();
  if (!redis) return null;

  try {
    fileProcessingQueue = new Queue(FILE_PROCESSING_QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    });

    return fileProcessingQueue;
  } catch (error) {
    console.warn("[Queue] Could not initialize file processing queue:", error);
    return null;
  }
};

export const getCleanupQueue = (): Queue | null => {
  if (cleanupQueue) return cleanupQueue;

  const redis = getRedisClient();
  if (!redis) return null;

  try {
    cleanupQueue = new Queue(CLEANUP_QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: "fixed",
          delay: 5000,
        },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 20 },
      },
    });

    return cleanupQueue;
  } catch (error) {
    console.warn("[Queue] Could not initialize cleanup queue:", error);
    return null;
  }
};

export const getAccountDeletionQueue = (): Queue | null => {
  if (accountDeletionQueue) return accountDeletionQueue;

  const redis = getRedisClient();
  // Do not wait indefinitely on BullMQ when the API's Redis connection is
  // configured but currently unavailable; the durable DB task will recover.
  if (!redis || (redis.status !== "ready" && redis.status !== "connect")) {
    return null;
  }

  try {
    accountDeletionQueue = new Queue(ACCOUNT_DELETION_QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        // The database task is the durable identity. Retaining completed jobs
        // with the same deterministic ID can block a later recovery enqueue.
        removeOnComplete: true,
        // The database task is the retry history and recovery source of
        // truth, so failed BullMQ jobs may be recreated with the same ID.
        removeOnFail: true,
      },
    });

    return accountDeletionQueue;
  } catch (error) {
    console.warn("[Queue] Could not initialize account deletion queue:", error);
    return null;
  }
};

export const enqueueFileProcessingJob = async (
  fileId: string,
): Promise<void> => {
  const queue = getFileProcessingQueue();

  if (queue) {
    try {
      await queue.add("process-file", { fileId }, {
        jobId: `file-${fileId}`,
      });
      return;
    } catch (error) {
      console.warn(
        `[Queue] Failed to enqueue file ${fileId}; using inline fallback:`,
        error,
      );
    }
  }

  setImmediate(() => {
    processFileJob({ fileId }).catch((error) => {
      console.error(`[InlineProcessor] Error processing file ${fileId}:`, error);
    });
  });
};

export const enqueueCleanupJob = async (): Promise<void> => {
  const queue = getCleanupQueue();

  if (queue) {
    try {
      await queue.add("run-cleanup", {}, {
        jobId: `cleanup-${Date.now()}`,
      });
      return;
    } catch (error) {
      console.warn(
        "[Queue] Failed to enqueue cleanup job; using inline fallback:",
        error,
      );
    }
  }

  setImmediate(() => {
    processCleanupJob().catch((error) => {
      console.error("[InlineProcessor] Error in cleanup job:", error);
    });
  });
};

export const enqueueAccountDeletionJob = async (
  userId: string,
): Promise<boolean> => {
  const queue = getAccountDeletionQueue();

  if (queue) {
    try {
      let timeoutId: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Account deletion enqueue timed out")),
          ACCOUNT_DELETION_ENQUEUE_TIMEOUT_MS,
        );
        timeoutId.unref();
      });

      try {
        await Promise.race([
          queue.add(
            "delete-account",
            { userId },
            { jobId: `account-deletion-${userId}` },
          ),
          timeout,
        ]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
      return true;
    } catch (error) {
      console.warn(
        `[Queue] Failed to enqueue account deletion for ${userId}; using inline fallback:`,
        error,
      );
    }
  }

  // The database task remains pending and is recovered by the API process or
  // standalone worker without pretending that deletion completed.
  return false;
};

export const scheduleAccountDeletionRecovery = async (): Promise<void> => {
  const queue = getAccountDeletionQueue();

  if (!queue) {
    throw new Error(
      "Account deletion queue is unavailable. Check Redis connection.",
    );
  }

  await queue.upsertJobScheduler(
    ACCOUNT_DELETION_RECOVERY_SCHEDULER_ID,
    {
      every: ACCOUNT_DELETION_RECOVERY_INTERVAL_MS,
    },
    {
      name: "recover-account-deletions",
      data: {},
    },
  );
};

/**
 * Schedule recurring cleanup of expired share links.
 * Call this once when the standalone worker starts.
 */
export const scheduleCleanupJobs = async (): Promise<void> => {
  const queue = getCleanupQueue();

  if (!queue) {
    throw new Error("Cleanup queue is unavailable. Check Redis connection.");
  }

  await queue.upsertJobScheduler(
    CLEANUP_SCHEDULER_ID,
    {
      every: CLEANUP_INTERVAL_MS,
    },
    {
      name: "run-cleanup",
      data: {},
    },
  );

  console.log("[Queue] Expired share-link cleanup scheduled (every hour).");
};

export const closeQueues = async (): Promise<void> => {
  const closePromises: Promise<void>[] = [];

  if (fileProcessingQueue) {
    closePromises.push(fileProcessingQueue.close());
    fileProcessingQueue = null;
  }

  if (cleanupQueue) {
    closePromises.push(cleanupQueue.close());
    cleanupQueue = null;
  }

  if (accountDeletionQueue) {
    closePromises.push(accountDeletionQueue.close());
    accountDeletionQueue = null;
  }

  await Promise.allSettled(closePromises);
  console.log("[Queue] Queues closed gracefully.");
};


