import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockWorkerConstructor,
  mockWorkerClose,
  mockWorkerOn,
  mockWorkerWaitUntilReady,
  mockWorkerIsRunning,
  mockGetRedisClient,
  mockRedisConnect,
  mockRedisPing,
  mockCloseRedisConnection,
  mockScheduleCleanupJobs,
  mockScheduleAccountDeletionRecovery,
  mockCloseQueues,
  mockProcessFileJob,
  mockProcessCleanupJob,
  mockProcessAccountDeletionJob,
  mockRecoverPendingAccountDeletions,
  mockPendingAccounts,
  mockConsoleLog,
  mockConsoleError,
} = vi.hoisted(() => ({
  mockWorkerConstructor: vi.fn(),
  mockWorkerClose: vi.fn(),
  mockWorkerOn: vi.fn(),
  mockWorkerWaitUntilReady: vi.fn(),
  mockWorkerIsRunning: vi.fn(),
  mockGetRedisClient: vi.fn(),
  mockRedisConnect: vi.fn(),
  mockRedisPing: vi.fn(),
  mockCloseRedisConnection: vi.fn(),
  mockScheduleCleanupJobs: vi.fn(),
  mockScheduleAccountDeletionRecovery: vi.fn(),
  mockCloseQueues: vi.fn(),
  mockProcessFileJob: vi.fn(),
  mockProcessCleanupJob: vi.fn(),
  mockProcessAccountDeletionJob: vi.fn(),
  mockRecoverPendingAccountDeletions: vi.fn(),
  mockPendingAccounts: vi.fn(),
  mockConsoleLog: vi.fn(),
  mockConsoleError: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Worker: class {
    on = mockWorkerOn;
    close = mockWorkerClose;
    waitUntilReady = mockWorkerWaitUntilReady;
    isRunning = mockWorkerIsRunning;

    constructor(...args: unknown[]) {
      mockWorkerConstructor(...args);
    }
  },
}));

vi.mock("../../config/redis.js", () => ({
  getRedisClient: mockGetRedisClient,
  closeRedisConnection: mockCloseRedisConnection,
}));

vi.mock("../queues.js", () => ({
  FILE_PROCESSING_QUEUE_NAME: "file-processing",
  CLEANUP_QUEUE_NAME: "maintenance-cleanup",
  ACCOUNT_DELETION_QUEUE_NAME: "account-deletion",
  enqueueAccountDeletionJob: mockPendingAccounts,
  scheduleCleanupJobs: mockScheduleCleanupJobs,
  scheduleAccountDeletionRecovery: mockScheduleAccountDeletionRecovery,
  closeQueues: mockCloseQueues,
}));

vi.mock("../processors/fileProcessor.js", () => ({
  processFileJob: mockProcessFileJob,
}));

vi.mock("../processors/cleanupProcessor.js", () => ({
  processCleanupJob: mockProcessCleanupJob,
}));

vi.mock("../../config/database.js", () => ({
  prisma: {
    user: {
      findMany: mockPendingAccounts,
    },
  },
}));

vi.mock("../processors/accountDeletionProcessor.js", () => ({
  processAccountDeletionJob: mockProcessAccountDeletionJob,
}));

vi.mock("../accountDeletionRecovery.js", () => ({
  recoverPendingAccountDeletions: mockRecoverPendingAccountDeletions,
}));

const mockRedis = {
  status: "ready",
  connect: mockRedisConnect,
  ping: mockRedisPing,
};

const loadWorker = async () => {
  vi.resetModules();
  return import("../worker.js");
};

beforeEach(() => {
  vi.clearAllMocks();

  mockRedis.status = "ready";

  mockGetRedisClient.mockReturnValue(mockRedis);
  mockRedisConnect.mockResolvedValue(undefined);
  mockRedisPing.mockResolvedValue("PONG");

  mockWorkerClose.mockResolvedValue(undefined);
  mockWorkerOn.mockReturnThis();
  mockWorkerWaitUntilReady.mockResolvedValue(undefined);
  mockWorkerIsRunning.mockReturnValue(true);

  mockScheduleCleanupJobs.mockResolvedValue(undefined);
  mockScheduleAccountDeletionRecovery.mockResolvedValue(undefined);
  mockCloseQueues.mockResolvedValue(undefined);
  mockCloseRedisConnection.mockResolvedValue(undefined);

  mockProcessFileJob.mockResolvedValue(undefined);
  mockProcessCleanupJob.mockResolvedValue(undefined);
  mockProcessAccountDeletionJob.mockResolvedValue(undefined);
  mockRecoverPendingAccountDeletions.mockResolvedValue(undefined);
  mockPendingAccounts.mockResolvedValue([]);

  vi.spyOn(console, "log").mockImplementation(mockConsoleLog);
  vi.spyOn(console, "error").mockImplementation(mockConsoleError);
});

describe("startWorkers", () => {
  it("throws when Redis is unavailable", async () => {
    mockGetRedisClient.mockReturnValue(null);

    const worker = await loadWorker();

    await expect(worker.startWorkers()).rejects.toThrow(
      "Redis is disabled or could not be initialized.",
    );

    expect(mockWorkerConstructor).not.toHaveBeenCalled();
  });

  it("connects to Redis and verifies the connection", async () => {
    const worker = await loadWorker();

    await worker.startWorkers();

    expect(mockRedisConnect).toHaveBeenCalledTimes(1);
    expect(mockRedisPing).toHaveBeenCalledTimes(1);
    expect(mockWorkerWaitUntilReady).toHaveBeenCalledTimes(3);
  });

  it("creates all workers with the correct configuration", async () => {
    const worker = await loadWorker();

    await worker.startWorkers();

    expect(mockWorkerConstructor).toHaveBeenCalledTimes(3);

    expect(mockWorkerConstructor).toHaveBeenNthCalledWith(
      1,
      "file-processing",
      expect.any(Function),
      {
        connection: mockRedis,
        concurrency: 5,
      },
    );

    expect(mockWorkerConstructor).toHaveBeenNthCalledWith(
      3,
      "account-deletion",
      expect.any(Function),
      {
        connection: mockRedis,
        concurrency: 1,
      },
    );

    expect(mockWorkerConstructor).toHaveBeenNthCalledWith(
      2,
      "maintenance-cleanup",
      expect.any(Function),
      {
        connection: mockRedis,
        concurrency: 1,
      },
    );
  });

  it("schedules cleanup jobs after creating workers", async () => {
    const worker = await loadWorker();

    await worker.startWorkers();

    expect(mockScheduleCleanupJobs).toHaveBeenCalledTimes(1);
    expect(mockWorkerConstructor).toHaveBeenCalledTimes(3);
  });

  it("does not create duplicate workers when already running", async () => {
    const worker = await loadWorker();

    await worker.startWorkers();

    mockWorkerConstructor.mockClear();

    await worker.startWorkers();

    expect(mockWorkerConstructor).not.toHaveBeenCalled();
  });

  it("handles Redis connect failure when Redis is already ready", async () => {
    mockRedisConnect.mockRejectedValue(new Error("Already connected"));
    mockRedis.status = "ready";

    const worker = await loadWorker();

    await expect(worker.startWorkers()).resolves.toBeUndefined();

    expect(mockRedisPing).toHaveBeenCalledTimes(1);
  });

  it("handles Redis connect failure when Redis is connecting", async () => {
    mockRedisConnect.mockRejectedValue(new Error("Connection in progress"));
    mockRedis.status = "connect";
    mockRedisPing.mockImplementation(async () => {
      mockRedis.status = "ready";
      return "PONG";
    });

    const worker = await loadWorker();

    await expect(worker.startWorkers()).resolves.toBeUndefined();

    expect(mockRedisPing).toHaveBeenCalledTimes(1);
  });

  it("throws when Redis connection fails in a disconnected state", async () => {
    mockRedisConnect.mockRejectedValue(new Error("Connection failed"));
    mockRedis.status = "end";

    const worker = await loadWorker();

    await expect(worker.startWorkers()).rejects.toThrow(
      "Connection failed",
    );

    expect(mockRedisPing).not.toHaveBeenCalled();
    expect(mockWorkerConstructor).not.toHaveBeenCalled();
  });

  it("throws when Redis ping fails", async () => {
    mockRedisPing.mockRejectedValue(new Error("Ping failed"));

    const worker = await loadWorker();

    await expect(worker.startWorkers()).rejects.toThrow("Ping failed");

    expect(mockWorkerConstructor).not.toHaveBeenCalled();
  });

  it("closes workers when cleanup scheduling fails", async () => {
    mockScheduleCleanupJobs.mockRejectedValue(
      new Error("Scheduler unavailable"),
    );

    const worker = await loadWorker();

    await expect(worker.startWorkers()).rejects.toThrow(
      "Scheduler unavailable",
    );

    expect(mockWorkerClose).toHaveBeenCalledTimes(3);
    expect(mockCloseQueues).toHaveBeenCalledTimes(1);
    expect(mockCloseRedisConnection).toHaveBeenCalledTimes(1);
  });
});

describe("worker job processors", () => {
  it("processes file jobs using the file processor", async () => {
    const worker = await loadWorker();

    await worker.startWorkers();

    const fileProcessor = mockWorkerConstructor.mock.calls[0][1];

    const job = {
      id: "job-1",
      data: {
        fileId: "file-123",
      },
    };

    await fileProcessor(job);

    expect(mockProcessFileJob).toHaveBeenCalledWith({
      fileId: "file-123",
    });
  });

  it("processes cleanup jobs using the cleanup processor", async () => {
    const worker = await loadWorker();

    await worker.startWorkers();

    const cleanupProcessor = mockWorkerConstructor.mock.calls[1][1];

    const job = {
      id: "job-2",
      data: {},
    };

    await cleanupProcessor(job);

    expect(mockProcessCleanupJob).toHaveBeenCalledTimes(1);
  });

  it("propagates file processing errors", async () => {
    mockProcessFileJob.mockRejectedValue(
      new Error("File processing failed"),
    );

    const worker = await loadWorker();

    await worker.startWorkers();

    const fileProcessor = mockWorkerConstructor.mock.calls[0][1];

    await expect(
      fileProcessor({
        id: "job-3",
        data: { fileId: "file-123" },
      }),
    ).rejects.toThrow("File processing failed");
  });

  it("propagates cleanup processing errors", async () => {
    mockProcessCleanupJob.mockRejectedValue(
      new Error("Cleanup failed"),
    );

    const worker = await loadWorker();

    await worker.startWorkers();

    const cleanupProcessor = mockWorkerConstructor.mock.calls[1][1];

    await expect(
      cleanupProcessor({
        id: "job-4",
        data: {},
      }),
    ).rejects.toThrow("Cleanup failed");
  });

  it("processes account deletion jobs using the account deletion processor", async () => {
    const worker = await loadWorker();

    await worker.startWorkers();

    const accountDeletionProcessor = mockWorkerConstructor.mock.calls[2][1];

    await accountDeletionProcessor({
      id: "job-5",
      data: { userId: "user-123" },
    });

    expect(mockProcessAccountDeletionJob).toHaveBeenCalledWith({
      userId: "user-123",
    });
  });
});

describe("worker event listeners", () => {
  it("registers completed, failed and error listeners for both workers", async () => {
    const worker = await loadWorker();

    await worker.startWorkers();

    expect(mockWorkerOn).toHaveBeenCalledTimes(12);

    expect(mockWorkerOn).toHaveBeenCalledWith(
      "completed",
      expect.any(Function),
    );

    expect(mockWorkerOn).toHaveBeenCalledWith(
      "failed",
      expect.any(Function),
    );

    expect(mockWorkerOn).toHaveBeenCalledWith(
      "error",
      expect.any(Function),
    );

    expect(mockWorkerOn).toHaveBeenCalledWith(
      "ready",
      expect.any(Function),
    );
  });

  it("handles file worker completed events", async () => {
    const worker = await loadWorker();

    await worker.startWorkers();

    const completedHandler = mockWorkerOn.mock.calls.find(
      (call) =>
        call[0] === "completed" &&
        mockWorkerOn.mock.calls.indexOf(call) < 3,
    )?.[1];

    completedHandler({ id: "file-job-1" });

    expect(mockConsoleLog).toHaveBeenCalledWith(
      "[Worker] File job file-job-1 completed.",
    );
  });

  it("handles file worker failed events", async () => {
    const worker = await loadWorker();

    await worker.startWorkers();

    const failedHandler = mockWorkerOn.mock.calls.find(
      (call) =>
        call[0] === "failed" &&
        mockWorkerOn.mock.calls.indexOf(call) < 3,
    )?.[1];

    failedHandler({ id: "file-job-2" }, new Error("Processing failed"));

    expect(mockConsoleError).toHaveBeenCalledWith(
      "[Worker] File job file-job-2 failed: Processing failed",
    );
  });

  it("handles file worker errors", async () => {
    const worker = await loadWorker();

    await worker.startWorkers();

    const errorHandler = mockWorkerOn.mock.calls.find(
      (call) =>
        call[0] === "error" &&
        mockWorkerOn.mock.calls.indexOf(call) < 3,
    )?.[1];

    const error = new Error("Worker connection error");

    errorHandler(error);

    expect(mockConsoleError).toHaveBeenCalledWith(
      "[Worker] File worker error:",
      error,
    );
  });

  it("handles cleanup worker completed events", async () => {
    const worker = await loadWorker();

    await worker.startWorkers();

    const completedHandler = mockWorkerOn.mock.calls[3][1];

    completedHandler({ id: "cleanup-job-1" });

    expect(mockConsoleLog).toHaveBeenCalledWith(
      "[Worker] Cleanup job cleanup-job-1 completed.",
    );
  });

  it("handles cleanup worker failed events", async () => {
    const worker = await loadWorker();

    await worker.startWorkers();

    const failedHandler = mockWorkerOn.mock.calls[4][1];

    failedHandler({ id: "cleanup-job-2" }, new Error("Cleanup failed"));

    expect(mockConsoleError).toHaveBeenCalledWith(
      "[Worker] Cleanup job cleanup-job-2 failed: Cleanup failed",
    );
  });

  it("handles cleanup worker errors", async () => {
    const worker = await loadWorker();

    await worker.startWorkers();

    const errorHandler = mockWorkerOn.mock.calls[5][1];
    const error = new Error("Cleanup worker error");

    errorHandler(error);

    expect(mockConsoleError).toHaveBeenCalledWith(
      "[Worker] Cleanup worker error:",
      error,
    );
  });

  it("handles failed events when the job is undefined", async () => {
    const worker = await loadWorker();

    await worker.startWorkers();

    const fileFailedHandler = mockWorkerOn.mock.calls[1][1];
    const cleanupFailedHandler = mockWorkerOn.mock.calls[4][1];

    fileFailedHandler(undefined, new Error("File failed"));
    cleanupFailedHandler(undefined, new Error("Cleanup failed"));

    expect(mockConsoleError).toHaveBeenCalledWith(
      "[Worker] File job undefined failed: File failed",
    );

    expect(mockConsoleError).toHaveBeenCalledWith(
      "[Worker] Cleanup job undefined failed: Cleanup failed",
    );
  });
});

describe("closeWorkers", () => {
  it("closes workers, queues and Redis connection", async () => {
    const worker = await loadWorker();

    await worker.startWorkers();
    await worker.closeWorkers();

    expect(mockWorkerClose).toHaveBeenCalledTimes(3);
    expect(mockCloseQueues).toHaveBeenCalledTimes(1);
    expect(mockCloseRedisConnection).toHaveBeenCalledTimes(1);
  });

  it("handles shutdown when workers were never started", async () => {
    const worker = await loadWorker();

    await expect(worker.closeWorkers()).resolves.toBeUndefined();

    expect(mockWorkerClose).not.toHaveBeenCalled();
    expect(mockCloseQueues).toHaveBeenCalledTimes(1);
    expect(mockCloseRedisConnection).toHaveBeenCalledTimes(1);
  });

  it("can safely close workers more than once", async () => {
    const worker = await loadWorker();

    await worker.startWorkers();

    await worker.closeWorkers();
    await worker.closeWorkers();

    expect(mockWorkerClose).toHaveBeenCalledTimes(3);
    expect(mockCloseQueues).toHaveBeenCalledTimes(2);
    expect(mockCloseRedisConnection).toHaveBeenCalledTimes(2);
  });
});

describe("worker health server", () => {
  it("evaluates worker readiness correctly", async () => {
    const worker = await loadWorker();

    // Before workers are started
    expect(worker.workersAreReady(true)).toBe(false);
    expect(worker.workersAreReady(false)).toBe(false);

    await worker.startWorkers();

    // After workers are started and ready
    expect(worker.workersAreReady(true)).toBe(true);
    expect(worker.workersAreReady(false)).toBe(false);

    await worker.closeWorkers();
  });

  it("serves health status and responds with 503 when not ready, 200 when ready, and 404 for unknown endpoints", async () => {
    const worker = await loadWorker();

    const server = await worker.startHealthServer(0, "127.0.0.1");
    expect(worker.getHealthServer()).toBe(server);

    const address = server.address();
    expect(address).toBeDefined();
    const port = typeof address === "object" && address !== null ? address.port : 8001;

    // 1. Before workers are started, /health/ready should return 503
    const resNotReady = await fetch(`http://127.0.0.1:${port}/health/ready`);
    expect(resNotReady.status).toBe(503);
    const bodyNotReady = await resNotReady.json();
    expect(bodyNotReady).toEqual({ status: "not-ready" });

    // 2. 404 for unknown path or method
    const resNotFound = await fetch(`http://127.0.0.1:${port}/unknown`);
    expect(resNotFound.status).toBe(404);

    const resPost = await fetch(`http://127.0.0.1:${port}/health/ready`, { method: "POST" });
    expect(resPost.status).toBe(404);

    // 3. Start workers and verify 200 ready
    await worker.startWorkers();
    const resReady = await fetch(`http://127.0.0.1:${port}/health/ready`);
    expect(resReady.status).toBe(200);
    const bodyReady = await resReady.json();
    expect(bodyReady).toEqual({ status: "ready" });

    // 4. closeWorkers shuts down healthServer
    await worker.closeWorkers();
    expect(worker.getHealthServer()).toBeNull();
  });
});
