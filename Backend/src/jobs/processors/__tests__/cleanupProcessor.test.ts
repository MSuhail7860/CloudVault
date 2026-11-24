import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: {
    shareLink: {
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../../config/database.js";
import { processCleanupJob } from "../cleanupProcessor.js";

const db = vi.mocked(prisma);

describe("cleanupProcessor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("revokes expired share links and returns the count", async () => {
    vi.mocked(db.shareLink.updateMany).mockResolvedValue({
      count: 3,
    });

    const result = await processCleanupJob();

    expect(result).toEqual({
      expiredLinksRevoked: 3,
    });

    expect(db.shareLink.updateMany).toHaveBeenCalledOnce();
  });

  it("returns zero when no expired links are found", async () => {
    vi.mocked(db.shareLink.updateMany).mockResolvedValue({
      count: 0,
    });

    const result = await processCleanupJob();

    expect(result).toEqual({
      expiredLinksRevoked: 0,
    });
  });

  it("uses the correct conditions to find expired links", async () => {
    vi.mocked(db.shareLink.updateMany).mockResolvedValue({
      count: 2,
    });

    await processCleanupJob();

    const [query] = vi.mocked(db.shareLink.updateMany).mock.calls[0];

    expect(query.where).toEqual({
      revokedAt: null,
      expiresAt: {
        lte: expect.any(Date),
      },
    });

    expect(query.data).toEqual({
      revokedAt: expect.any(Date),
    });
  });

  it("propagates database errors", async () => {
    const error = new Error("Database connection failed");

    vi.mocked(db.shareLink.updateMany).mockRejectedValue(error);

    await expect(processCleanupJob()).rejects.toThrow(
      "Database connection failed",
    );
  });
});