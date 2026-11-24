import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  deleteMany: vi.fn(),
  deleteObject: vi.fn(),
  transaction: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock("../../config/database.js", () => ({
  prisma: {
    storageObjectTask: {
      updateMany: mocks.updateMany,
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      deleteMany: mocks.deleteMany,
    },
    $transaction: mocks.transaction,
    $executeRaw: mocks.executeRaw,
  },
}));

vi.mock("../storageService.js", () => ({
  deleteObject: mocks.deleteObject,
}));

import {
  processStorageObjectTask,
  recoverStorageObjectTasks,
  startStorageObjectCleanupHeartbeat,
} from "../storageObjectTaskService.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.findFirst.mockResolvedValue({ storageKey: "user-1/object" });
  mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.deleteObject.mockResolvedValue(undefined);
  mocks.findMany.mockResolvedValue([{ id: "task-1" }]);
  mocks.transaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) => callback({}),
  );
  mocks.executeRaw.mockResolvedValue(1);
});

describe("storage object cleanup tasks", () => {
  it("renews a slow cleanup lease with the current claim token", async () => {
    vi.useFakeTimers();

    try {
      const heartbeat = startStorageObjectCleanupHeartbeat(
        "task-1",
        "claim-token",
      );

      await vi.advanceTimersByTimeAsync(60 * 1000);

      expect(mocks.updateMany).toHaveBeenCalledWith({
        where: {
          id: "task-1",
          status: "PROCESSING",
          claimToken: "claim-token",
        },
        data: { leaseUntil: expect.any(Date) },
      });

      heartbeat.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the cleanup lease lost when a claim-token heartbeat fails", async () => {
    vi.useFakeTimers();
    mocks.updateMany.mockRejectedValue(new Error("Database unavailable"));

    try {
      const heartbeat = startStorageObjectCleanupHeartbeat(
        "task-1",
        "claim-token",
      );

      await vi.advanceTimersByTimeAsync(60 * 1000);

      expect(heartbeat.isLost()).toBe(true);
      heartbeat.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes the object before conditionally removing its claimed task", async () => {
    await expect(processStorageObjectTask("task-1")).resolves.toBe(true);

    expect(mocks.deleteObject).toHaveBeenCalledWith("user-1/object");
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "task-1",
        status: "PROCESSING",
        claimToken: expect.any(String),
      },
    });
  });

  it("does not remove a cleanup task after a slow delete loses its lease", async () => {
    vi.useFakeTimers();
    mocks.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    let resolveDelete!: () => void;
    mocks.deleteObject.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveDelete = resolve;
      }),
    );

    try {
      const processing = processStorageObjectTask("task-1");
      await vi.advanceTimersByTimeAsync(60 * 1000);
      resolveDelete();

      await expect(processing).rejects.toMatchObject({ statusCode: 409 });
      expect(mocks.deleteMany).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not process a task another worker already claimed", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(processStorageObjectTask("task-1")).resolves.toBe(false);
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it("records retry state when a worker is interrupted by storage failure", async () => {
    mocks.deleteObject.mockRejectedValue(new Error("Storage unavailable"));

    await expect(processStorageObjectTask("task-1")).rejects.toThrow(
      "Storage unavailable",
    );
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: "task-1",
        status: "PROCESSING",
        claimToken: expect.any(String),
      },
      data: {
        status: "PENDING_CLEANUP",
        claimToken: null,
        leaseUntil: null,
        nextAttemptAt: expect.any(Date),
      },
    });
  });

  it("recovers expired upload reservations before processing cleanup", async () => {
    await recoverStorageObjectTasks();

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        status: "UPLOADING",
        leaseUntil: { lt: expect.any(Date) },
      },
      data: {
        status: "PENDING_CLEANUP",
        leaseUntil: null,
        nextAttemptAt: expect.any(Date),
      },
    });
    expect(mocks.deleteObject).toHaveBeenCalledWith("user-1/object");
  });
});
