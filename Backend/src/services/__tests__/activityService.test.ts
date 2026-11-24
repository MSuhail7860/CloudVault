import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/database.js", () => ({
  prisma: {
    activity: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { prisma } from "../../config/database.js";
import { logActivity, listActivities } from "../activityService.js";

const db = vi.mocked(prisma);

describe("activityService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("logActivity", () => {
    it("creates an activity entry when not a recent duplicate", async () => {
      vi.mocked(db.activity.findFirst).mockResolvedValue(null);
      vi.mocked(db.activity.create).mockResolvedValue({
        id: "act-1",
        userId: "user-1",
        action: "FILE_UPLOADED",
        resourceType: "FILE",
        resourceId: "file-1",
        resourceName: "document.pdf",
        details: null,
        createdAt: new Date(),
      } as never);

      const result = await logActivity({
        userId: "user-1",
        action: "FILE_UPLOADED",
        resourceType: "FILE",
        resourceId: "file-1",
        resourceName: "document.pdf",
      });

      expect(result).toBeDefined();
      expect(result?.id).toBe("act-1");
      expect(db.activity.create).toHaveBeenCalledOnce();
    });

    it("prevents duplicate activity logged within 3 seconds", async () => {
      vi.mocked(db.activity.findFirst).mockResolvedValue({
        id: "existing-act",
      } as never);

      const result = await logActivity({
        userId: "user-1",
        action: "FILE_DOWNLOADED",
        resourceType: "FILE",
        resourceId: "file-1",
        resourceName: "document.pdf",
      });

      expect(result).toBeNull();
      expect(db.activity.create).not.toHaveBeenCalled();
    });
  });

  describe("listActivities", () => {
    it("returns paginated activities for the given user", async () => {
      vi.mocked(db.activity.count).mockResolvedValue(1);
      vi.mocked(db.activity.findMany).mockResolvedValue([
        {
          id: "act-1",
          action: "FILE_UPLOADED",
          resourceType: "FILE",
          resourceId: "file-1",
          resourceName: "document.pdf",
          details: null,
          createdAt: new Date(),
          user: {
            id: "user-1",
            name: "Alice",
            email: "alice@example.com",
          },
        },
      ] as never);

      const result = await listActivities({
        userId: "user-1",
        page: 1,
        limit: 10,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].action).toBe("FILE_UPLOADED");
      expect(result.data[0].user.email).toBe("alice@example.com");
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.totalPages).toBe(1);
    });
  });
});

