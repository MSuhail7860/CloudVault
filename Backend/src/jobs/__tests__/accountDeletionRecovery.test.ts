import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findPendingUsers: vi.fn(),
  findDueTasks: vi.fn(),
  enqueue: vi.fn(),
  ensureTask: vi.fn(),
  processInline: vi.fn(),
}));

vi.mock("../../config/database.js", () => ({
  prisma: {
    user: { findMany: mocks.findPendingUsers },
    accountDeletionTask: { findMany: mocks.findDueTasks },
  },
}));

vi.mock("../../services/storageObjectTaskService.js", () => ({
  recoverStorageObjectTasks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues.js", () => ({
  enqueueAccountDeletionJob: mocks.enqueue,
}));

vi.mock("../../services/accountDeletionService.js", () => ({
  ensureAccountDeletionTask: mocks.ensureTask,
  processAccountDeletionJob: mocks.processInline,
}));

import { recoverPendingAccountDeletions } from "../accountDeletionRecovery.js";

describe("account deletion recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findPendingUsers.mockResolvedValue([{ id: "user-1" }, { id: "user-2" }]);
    mocks.findDueTasks.mockResolvedValue([
      { userId: "user-1" },
      { userId: "user-2" },
    ]);
    mocks.ensureTask.mockResolvedValue(undefined);
    mocks.enqueue.mockResolvedValue(true);
    mocks.processInline.mockResolvedValue(undefined);
  });

  it("recreates durable queue work for every pending account", async () => {
    await recoverPendingAccountDeletions();

    expect(mocks.ensureTask).toHaveBeenCalledTimes(2);
    expect(mocks.enqueue).toHaveBeenNthCalledWith(1, "user-1");
    expect(mocks.enqueue).toHaveBeenNthCalledWith(2, "user-2");
    expect(mocks.processInline).not.toHaveBeenCalled();
  });

  it("processes the durable task inline when Redis cannot enqueue it", async () => {
    mocks.enqueue.mockResolvedValue(false);

    await recoverPendingAccountDeletions();

    expect(mocks.processInline).toHaveBeenCalledWith({ userId: "user-1" });
    expect(mocks.processInline).toHaveBeenCalledWith({ userId: "user-2" });
  });

  it("enqueues only deletion tasks whose retry time is due", async () => {
    mocks.findDueTasks.mockResolvedValue([{ userId: "user-1" }]);

    await recoverPendingAccountDeletions();

    expect(mocks.enqueue).toHaveBeenCalledOnce();
    expect(mocks.enqueue).toHaveBeenCalledWith("user-1");
    expect(mocks.processInline).not.toHaveBeenCalled();
  });

  it("continues recovery for other accounts when task repair fails", async () => {
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.ensureTask
      .mockRejectedValueOnce(new Error("database detail"))
      .mockResolvedValueOnce(undefined);

    await recoverPendingAccountDeletions();

    expect(mocks.ensureTask).toHaveBeenCalledTimes(2);
    expect(mocks.enqueue).toHaveBeenNthCalledWith(1, "user-1");
    expect(mocks.enqueue).toHaveBeenNthCalledWith(2, "user-2");
    expect(logError).toHaveBeenCalledWith(
      JSON.stringify({
        event: "account_deletion_task_recovery_failed",
        userId: "user-1",
        errorName: "Error",
      }),
    );
    expect(logError.mock.calls.flat().join(" ")).not.toContain("database detail");
    logError.mockRestore();
  });
});
