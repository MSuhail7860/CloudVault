
import "dotenv/config";

import { createServer, type Server } from "node:http";
import { Worker, type Job } from "bullmq";
import { getRedisClient, closeRedisConnection } from "../config/redis.js";
import {
  FILE_PROCESSING_QUEUE_NAME,
  CLEANUP_QUEUE_NAME,
  ACCOUNT_DELETION_QUEUE_NAME,
  scheduleAccountDeletionRecovery,
  scheduleCleanupJobs,
  closeQueues,
} from "./queues.js";
import {
  processFileJob,
  type FileProcessingData,
} from "./processors/fileProcessor.js";
import { processCleanupJob } from "./processors/cleanupProcessor.js";
import {
  processAccountDeletionJob,
  type AccountDeletionJobData,
} from "./processors/accountDeletionProcessor.js";
import { recoverPendingAccountDeletions } from "./accountDeletionRecovery.js";

let fileWorker: Worker | null = null;
let cleanupWorker: Worker | null = null;
let accountDeletionWorker: Worker | null = null;
let healthServer: Server | null = null;
let readyWorkers = new Set<Worker>();
let workerStartupComplete = false;
let isShuttingDown = false;

const getWorkers = (): Worker[] =>
  [fileWorker, cleanupWorker, accountDeletionWorker].filter(
    (worker): worker is Worker => worker !== null,
  );

export const workersAreReady = (redisReady: boolean): boolean => {
  const workers = getWorkers();
  return (
    workerStartupComplete &&
    redisReady &&
    workers.length === 3 &&
    workers.every((worker) => readyWorkers.has(worker) && worker.isRunning())
  );
};

export const startHealthServer = async (
  port = Number(process.env.WORKER_HEALTH_PORT ?? 8001),
  host = process.env.WORKER_HEALTH_HOST ?? "0.0.0.0",
): Promise<Server> => {
  if (healthServer) {
    return healthServer;
  }

  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/health/ready") {
      response.writeHead(404).end();
      return;
    }

    const ready = workersAreReady(getRedisClient()?.status === "ready");
    response.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: ready ? "ready" : "not-ready" }));
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      healthServer = server;
      resolve();
    });
  });

  return server;
};

export const getHealthServer = (): Server | null => healthServer;

export const startWorkers = async (): Promise<void> => {
  if (fileWorker || cleanupWorker || accountDeletionWorker) {
    console.log("[Worker] Workers are already running.");
    return;
  }

  const redis = getRedisClient();

  if (!redis) {
    throw new Error("Redis is disabled or could not be initialized.");
  }

  try {
    await redis.connect();
  } catch (error) {
    // ioredis may already be connecting or connected.
    if (redis.status !== "ready" && redis.status !== "connect") {
      throw error;
    }
  }

  await redis.ping();
  readyWorkers = new Set();
  workerStartupComplete = false;

  fileWorker = new Worker<FileProcessingData>(
    FILE_PROCESSING_QUEUE_NAME,
    async (job: Job<FileProcessingData>) => {
      console.log(
        `[Worker] Processing job ${job.id} for file ${job.data.fileId}`,
      );
      await processFileJob(job.data);
    },
    {
      connection: redis,
      concurrency: 5,
    },
  );

  cleanupWorker = new Worker(
    CLEANUP_QUEUE_NAME,
    async (job: Job) => {
      console.log(`[Worker] Running cleanup job ${job.id}`);
      await processCleanupJob();
    },
    {
      connection: redis,
      concurrency: 1,
    },
  );

  accountDeletionWorker = new Worker<AccountDeletionJobData>(
    ACCOUNT_DELETION_QUEUE_NAME,
    async (job: Job<AccountDeletionJobData>) => {
      if (job.name === "recover-account-deletions") {
        await recoverPendingAccountDeletions();
        return;
      }

      console.log(
        `[Worker] Processing account deletion job ${job.id} for user ${job.data.userId}`,
      );
      await processAccountDeletionJob(job.data);
    },
    {
      connection: redis,
      concurrency: 1,
    },
  );

  fileWorker.on("completed", (job) => {
    console.log(`[Worker] File job ${job.id} completed.`);
  });

  fileWorker.on("failed", (job, error) => {
    console.error(
      `[Worker] File job ${job?.id} failed: ${error.message}`,
    );
  });

  fileWorker.on("error", (error) => {
    readyWorkers.delete(fileWorker!);
    console.error("[Worker] File worker error:", error);
  });

  cleanupWorker.on("completed", (job) => {
    console.log(`[Worker] Cleanup job ${job.id} completed.`);
  });

  cleanupWorker.on("failed", (job, error) => {
    console.error(
      `[Worker] Cleanup job ${job?.id} failed: ${error.message}`,
    );
  });

  cleanupWorker.on("error", (error) => {
    readyWorkers.delete(cleanupWorker!);
    console.error("[Worker] Cleanup worker error:", error);
  });

  accountDeletionWorker.on("completed", (job) => {
    console.log(`[Worker] Account deletion job ${job.id} completed.`);
  });

  accountDeletionWorker.on("failed", (job, error) => {
    console.error(
      `[Worker] Account deletion job ${job?.id} failed: ${error.message}`,
    );
  });

  accountDeletionWorker.on("error", (error) => {
    readyWorkers.delete(accountDeletionWorker!);
    console.error("[Worker] Account deletion worker error:", error);
  });

  fileWorker.on("ready", () => readyWorkers.add(fileWorker!));
  cleanupWorker.on("ready", () => readyWorkers.add(cleanupWorker!));
  accountDeletionWorker.on("ready", () =>
    readyWorkers.add(accountDeletionWorker!),
  );

  try {
    const workers = getWorkers();
    await Promise.all(workers.map((worker) => worker.waitUntilReady()));
    if (workers.some((worker) => !worker.isRunning())) {
      throw new Error("A BullMQ worker stopped during startup.");
    }
    workers.forEach((worker) => readyWorkers.add(worker));

    await scheduleCleanupJobs();
    await scheduleAccountDeletionRecovery();

    await recoverPendingAccountDeletions();
    if (
      redis.status !== "ready" ||
      workers.some(
        (worker) => !readyWorkers.has(worker) || !worker.isRunning(),
      )
    ) {
      throw new Error("BullMQ worker readiness was lost during startup.");
    }
    workerStartupComplete = true;
  } catch (error) {
    await closeWorkers();
    throw error;
  }

  console.log(
    "[Worker] File, cleanup, and account deletion workers started successfully.",
  );
};

export const closeWorkers = async (): Promise<void> => {
  const closePromises: Promise<void>[] = [];

  if (fileWorker) {
    closePromises.push(fileWorker.close());
    fileWorker = null;
  }

  if (cleanupWorker) {
    closePromises.push(cleanupWorker.close());
    cleanupWorker = null;
  }

  if (accountDeletionWorker) {
    closePromises.push(accountDeletionWorker.close());
    accountDeletionWorker = null;
  }

  workerStartupComplete = false;
  readyWorkers.clear();
  if (healthServer) {
    const server = healthServer;
    healthServer = null;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  await Promise.allSettled(closePromises);
  await closeQueues();
  await closeRedisConnection();

  console.log("[Worker] Shutdown completed.");
};

// Start only when this file is executed directly.
if (
  process.argv[1]?.endsWith("worker.ts") ||
  process.argv[1]?.endsWith("worker.js")
) {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`[Worker] Received ${signal}. Shutting down...`);

    await closeWorkers();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  startWorkers()
    .then(() => startHealthServer())
    .catch(async (error) => {
      console.error("[Worker] Startup or health endpoint failed:", error);
      await closeWorkers();
      process.exit(1);
    });
}
