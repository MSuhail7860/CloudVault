
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockQueueAdd,
  mockUpsertJobScheduler,
  mockQueueClose,
  mockGetRedisClient,
  mockProcessFileJob,
  mockProcessCleanupJob,
  mockProcessAccountDeletionJob,
  mockQueueConstructor,
} = vi.hoisted(() => ({
  mockQueueAdd: vi.fn(),
  mockUpsertJobScheduler: vi.fn(),
  mockQueueClose: vi.fn(),
  mockGetRedisClient: vi.fn(),
  mockProcessFileJob: vi.fn(),
  mockProcessCleanupJob: vi.fn(),
  mockProcessAccountDeletionJob: vi.fn(),
  mockQueueConstructor: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Queue: class {
    add = mockQueueAdd;
    upsertJobScheduler = mockUpsertJobScheduler;
    close = mockQueueClose;

    constructor(...args: unknown[]) {
      mockQueueConstructor(...args);
    }
  },
}));

vi.mock("../../config/redis.js", () => ({
  getRedisClient: mockGetRedisClient,
}));

vi.mock("../processors/fileProcessor.js", () => ({
  processFileJob: mockProcessFileJob,
}));

vi.mock("../processors/cleanupProcessor.js", () => ({
  processCleanupJob: mockProcessCleanupJob,
}));

vi.mock("../processors/accountDeletionProcessor.js", () => ({
  processAccountDeletionJob: mockProcessAccountDeletionJob,
}));

const mockRedis = { status: "ready" };

const loadQueues = async () => {
  vi.resetModules();
  return import("../queues.js");
};

beforeEach(() => {
  vi.clearAllMocks();

  mockGetRedisClient.mockReturnValue(mockRedis);
  mockQueueAdd.mockResolvedValue({ id: "job-1" });
  mockUpsertJobScheduler.mockResolvedValue("scheduler-1");
  mockQueueClose.mockResolvedValue(undefined);
  mockProcessFileJob.mockResolvedValue(undefined);
  mockProcessCleanupJob.mockResolvedValue(undefined);
  mockProcessAccountDeletionJob.mockResolvedValue(undefined);
});

describe("Queue configuration", () => {
  it("exports the correct queue names", async () => {
    const queues = await loadQueues();

    expect(queues.FILE_PROCESSING_QUEUE_NAME).toBe("file-processing");
    expect(queues.CLEANUP_QUEUE_NAME).toBe("maintenance-cleanup");
    expect(queues.ACCOUNT_DELETION_QUEUE_NAME).toBe("account-deletion");
  });

  it("returns null when Redis is unavailable", async () => {
    mockGetRedisClient.mockReturnValue(null);

    const queues = await loadQueues();

    expect(queues.getFileProcessingQueue()).toBeNull();
    expect(queues.getCleanupQueue()).toBeNull();
    expect(queues.getAccountDeletionQueue()).toBeNull();
  });

  it("initializes the file processing queue with retry configuration", async () => {
    const queues = await loadQueues();

    const queue = queues.getFileProcessingQueue();

    expect(queue).not.toBeNull();
    expect(mockQueueConstructor).toHaveBeenCalledWith(
      "file-processing",
      expect.objectContaining({
        connection: mockRedis,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 2000,
          },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      }),
    );
  });

  it("initializes the cleanup queue with retry configuration", async () => {
    const queues = await loadQueues();

    const queue = queues.getCleanupQueue();

    expect(queue).not.toBeNull();
    expect(mockQueueConstructor).toHaveBeenCalledWith(
      "maintenance-cleanup",
      expect.objectContaining({
        connection: mockRedis,
        defaultJobOptions: {
          attempts: 2,
          backoff: {
            type: "fixed",
            delay: 5000,
          },
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 20 },
        },
      }),
    );
  });

  it("initializes the account deletion queue with exponential retries", async () => {
    const queues = await loadQueues();

    const queue = queues.getAccountDeletionQueue();

    expect(queue).not.toBeNull();
    expect(mockQueueConstructor).toHaveBeenCalledWith(
      "account-deletion",
      expect.objectContaining({
        connection: mockRedis,
        defaultJobOptions: {
          attempts: 5,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
          removeOnComplete: true,
          removeOnFail: true,
        },
      }),
    );
  });

  it("reuses an existing file queue instance", async () => {
    const queues = await loadQueues();

    const first = queues.getFileProcessingQueue();
    const second = queues.getFileProcessingQueue();

    expect(first).toBe(second);
    expect(mockQueueConstructor).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing cleanup queue instance", async () => {
    const queues = await loadQueues();

    const first = queues.getCleanupQueue();
    const second = queues.getCleanupQueue();

    expect(first).toBe(second);
    expect(mockQueueConstructor).toHaveBeenCalledTimes(1);
  });
});

describe("enqueueFileProcessingJob", () => {
  it("adds a file processing job with the expected ID", async () => {
    const queues = await loadQueues();

    await queues.enqueueFileProcessingJob("file-123");

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-file",
      { fileId: "file-123" },
      { jobId: "file-file-123" },
    );

    expect(mockProcessFileJob).not.toHaveBeenCalled();
  });

  it("uses inline fallback when Redis is unavailable", async () => {
    mockGetRedisClient.mockReturnValue(null);

    const immediateSpy = vi
      .spyOn(globalThis, "setImmediate")
      .mockImplementation((callback: () => void) => {
        callback();
        return {} as NodeJS.Immediate;
      });

    const queues = await loadQueues();

    await queues.enqueueFileProcessingJob("file-456");

    expect(mockProcessFileJob).toHaveBeenCalledWith({
      fileId: "file-456",
    });

    immediateSpy.mockRestore();
  });

  it("uses inline fallback when adding a job fails", async () => {
    mockQueueAdd.mockRejectedValue(new Error("Redis unavailable"));

    const immediateSpy = vi
      .spyOn(globalThis, "setImmediate")
      .mockImplementation((callback: () => void) => {
        callback();
        return {} as NodeJS.Immediate;
      });

    const queues = await loadQueues();

    await queues.enqueueFileProcessingJob("file-789");

    expect(mockProcessFileJob).toHaveBeenCalledWith({
      fileId: "file-789",
    });

    immediateSpy.mockRestore();
  });
});

describe("enqueueCleanupJob", () => {
  it("adds a cleanup job with a generated ID", async () => {
    const queues = await loadQueues();

    await queues.enqueueCleanupJob();

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "run-cleanup",
      {},
      expect.objectContaining({
        jobId: expect.stringMatching(/^cleanup-/),
      }),
    );

    expect(mockProcessCleanupJob).not.toHaveBeenCalled();
  });

  it("uses inline fallback when Redis is unavailable", async () => {
    mockGetRedisClient.mockReturnValue(null);

    const immediateSpy = vi
      .spyOn(globalThis, "setImmediate")
      .mockImplementation((callback: () => void) => {
        callback();
        return {} as NodeJS.Immediate;
      });

    const queues = await loadQueues();

    await queues.enqueueCleanupJob();

    expect(mockProcessCleanupJob).toHaveBeenCalledTimes(1);

    immediateSpy.mockRestore();
  });

  it("uses inline fallback when adding a cleanup job fails", async () => {
    mockQueueAdd.mockRejectedValue(new Error("Redis unavailable"));

    const immediateSpy = vi
      .spyOn(globalThis, "setImmediate")
      .mockImplementation((callback: () => void) => {
        callback();
        return {} as NodeJS.Immediate;
      });

    const queues = await loadQueues();

    await queues.enqueueCleanupJob();

    expect(mockProcessCleanupJob).toHaveBeenCalledTimes(1);

    immediateSpy.mockRestore();
  });

  it("enqueues account deletion jobs without treating them as completed", async () => {
    const queues = await loadQueues();

    await expect(
      queues.enqueueAccountDeletionJob("user-123"),
    ).resolves.toBe(true);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "delete-account",
      { userId: "user-123" },
      { jobId: "account-deletion-user-123" },
    );
    expect(mockProcessAccountDeletionJob).not.toHaveBeenCalled();
  });

  it("leaves a durable pending task for recovery when Redis is unavailable", async () => {
    mockGetRedisClient.mockReturnValue(null);

    const queues = await loadQueues();

    await expect(
      queues.enqueueAccountDeletionJob("user-456"),
    ).resolves.toBe(false);

    expect(mockProcessAccountDeletionJob).not.toHaveBeenCalled();
  });

  it("bounds an enqueue that hangs on an unavailable Redis connection", async () => {
    vi.useFakeTimers();
    mockQueueAdd.mockImplementation(() => new Promise(() => undefined));

    const queues = await loadQueues();
    const enqueue = queues.enqueueAccountDeletionJob("user-timeout");

    await vi.advanceTimersByTimeAsync(3000);

    await expect(enqueue).resolves.toBe(false);
    vi.useRealTimers();
  });
});

describe("scheduleCleanupJobs", () => {
  it("schedules cleanup to run every hour", async () => {
    const queues = await loadQueues();

    await queues.scheduleCleanupJobs();

    expect(mockUpsertJobScheduler).toHaveBeenCalledWith(
      "expired-share-links-cleanup",
      { every: 60 * 60 * 1000 },
      {
        name: "run-cleanup",
        data: {},
      },
    );
  });

  it("throws when the cleanup queue is unavailable", async () => {
    mockGetRedisClient.mockReturnValue(null);

    const queues = await loadQueues();

    await expect(queues.scheduleCleanupJobs()).rejects.toThrow(
      "Cleanup queue is unavailable. Check Redis connection.",
    );
  });

  it("schedules periodic recovery for pending account deletions", async () => {
    const queues = await loadQueues();

    await queues.scheduleAccountDeletionRecovery();

    expect(mockUpsertJobScheduler).toHaveBeenCalledWith(
      "pending-account-deletion-recovery",
      { every: 5 * 60 * 1000 },
      {
        name: "recover-account-deletions",
        data: {},
      },
    );
  });
});

describe("closeQueues", () => {
  it("closes initialized queues", async () => {
    const queues = await loadQueues();

    queues.getFileProcessingQueue();
    queues.getCleanupQueue();
    queues.getAccountDeletionQueue();

    await queues.closeQueues();

    expect(mockQueueClose).toHaveBeenCalledTimes(3);
  });

  it("handles closing when no queues were initialized", async () => {
    const queues = await loadQueues();

    await expect(queues.closeQueues()).resolves.toBeUndefined();

    expect(mockQueueClose).not.toHaveBeenCalled();
  });

  it("continues closing queues when one close operation rejects", async () => {
    mockQueueClose
      .mockRejectedValueOnce(new Error("Close failed"))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const queues = await loadQueues();

    queues.getFileProcessingQueue();
    queues.getCleanupQueue();
    queues.getAccountDeletionQueue();

    await expect(queues.closeQueues()).resolves.toBeUndefined();

    expect(mockQueueClose).toHaveBeenCalledTimes(3);
  });
});
