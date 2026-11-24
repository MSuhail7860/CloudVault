import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { delay, deferred } from "./testHelpers.js";
import { acquireUploadPermit } from "../services/uploadAdmissionService.js";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error("REDIS_URL must be set by the integration test runner");
}

const queueConnections: Redis[] = [];
const workers: Array<{ close: () => Promise<void> }> = [];
const queues: Queue[] = [];

const createConnection = () => {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  queueConnections.push(connection);
  return connection;
};

const closeQueueResources = async (): Promise<void> => {
  await Promise.allSettled(workers.splice(0).map((worker) => worker.close()));
  await Promise.allSettled(queues.splice(0).map((queue) => queue.close()));
  await Promise.allSettled(queueConnections.splice(0).map((connection) => connection.quit()));
};

describe("BullMQ with isolated Redis", () => {
  afterEach(async () => {
    await closeQueueResources();
  });

  it("processes a deterministic job and removes it after completion", async () => {
    const queueName = `account-deletion-integration-${randomUUID()}`;
    const queue = new Queue(queueName, {
      connection: createConnection(),
      defaultJobOptions: {
        attempts: 2,
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
    queues.push(queue);
    const processed = deferred<{ userId: string }>();
    const worker = new Worker(
      queueName,
      async (job) => {
        processed.resolve(job.data as { userId: string });
      },
      { connection: createConnection(), concurrency: 1 },
    );
    workers.push(worker);

    const job = await queue.add(
      "delete-account",
      { userId: "integration-user" },
      { jobId: "account-deletion-integration-user" },
    );

    await expect(processed.promise).resolves.toEqual({
      userId: "integration-user",
    });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (!(await queue.getJob(job.id!))) return;
      await delay(100);
    }

    throw new Error("Completed BullMQ job was not removed from Redis");
  });

  it("does not create duplicate work for a deterministic job ID", async () => {
    const queueName = `account-deletion-integration-${randomUUID()}`;
    const queue = new Queue(queueName, {
      connection: createConnection(),
      defaultJobOptions: { removeOnComplete: true, removeOnFail: true },
    });
    queues.push(queue);
    let processedCount = 0;
    const processed = deferred<void>();
    const worker = new Worker(
      queueName,
      async () => {
        processedCount += 1;
        processed.resolve();
      },
      { connection: createConnection(), concurrency: 2 },
    );
    workers.push(worker);

    const jobId = "account-deletion-integration-singleton";
    await Promise.all([
      queue.add("delete-account", { userId: "integration-user" }, { jobId }),
      queue.add("delete-account", { userId: "integration-user" }, { jobId }),
    ]);

    await processed.promise;
    await delay(100);
    expect(processedCount).toBe(1);
  });

  it("removes failed jobs so a later recovery can enqueue the same ID", async () => {
    const queueName = `account-deletion-integration-${randomUUID()}`;
    const queue = new Queue(queueName, {
      connection: createConnection(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
    queues.push(queue);
    const failed = deferred<void>();
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error("integration failure");
      },
      { connection: createConnection(), concurrency: 1 },
    );
    worker.on("failed", () => failed.resolve());
    workers.push(worker);

    const jobId = "account-deletion-integration-retry";
    await queue.add("delete-account", { userId: "integration-user" }, { jobId });
    await failed.promise;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (!(await queue.getJob(jobId))) break;
      await delay(100);
    }
    expect(await queue.getJob(jobId)).toBeUndefined();

    const replacement = await queue.add(
      "delete-account",
      { userId: "integration-user" },
      { jobId },
    );
    expect(replacement.id).toBe(jobId);
  });

  it("enforces upload concurrency through isolated Redis across API instances", async () => {
    const userId = `upload-it-${randomUUID()}`;
    const [first, second] = await Promise.all([
      acquireUploadPermit(userId),
      acquireUploadPermit(userId),
    ]);

    try {
      expect(first.status).toBe("ADMITTED");
      expect(second.status).toBe("ADMITTED");
      await expect(acquireUploadPermit(userId)).resolves.toMatchObject({
        status: "CONCURRENCY_LIMIT",
      });
    } finally {
      await Promise.all([
        first.permit?.release(),
        second.permit?.release(),
      ]);
    }
  });
});
