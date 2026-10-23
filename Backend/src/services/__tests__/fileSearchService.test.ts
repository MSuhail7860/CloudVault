import { beforeEach, describe, expect, it, vi } from "vitest";

const { findManyMock, countMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  countMock: vi.fn(),
}));

vi.mock("../../config/database.js", () => ({
  prisma: {
    file: {
      findMany: findManyMock,
      count: countMock,
    },
  },
}));

import { searchFiles } from "../fileSearchService.js";

const ownerId = "user-1";

const file = {
  id: "file-1",
  name: "Annual Report.pdf",
  originalName: "Annual Report.pdf",
  mimeType: "application/pdf",
  size: BigInt(1024),
  folderId: null,
  createdAt: new Date("2026-10-01T10:00:00Z"),
  updatedAt: new Date("2026-10-01T10:00:00Z"),
};

beforeEach(() => {
  vi.resetAllMocks();
  findManyMock.mockResolvedValue([]);
  countMock.mockResolvedValue(0);
});

describe("searchFiles", () => {
  it("searches active files by name for the specified owner", async () => {
    findManyMock.mockResolvedValue([file]);
    countMock.mockResolvedValue(1);

    const result = await searchFiles({
      ownerId,
      query: "  REPORT  ",
    });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerId,
          deletedAt: null,
          name: {
            contains: "REPORT",
            mode: "insensitive",
          },
        },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 10,
      }),
    );

    expect(countMock).toHaveBeenCalledWith({
      where: {
        ownerId,
        deletedAt: null,
        name: {
          contains: "REPORT",
          mode: "insensitive",
        },
      },
    });

    expect(result.items[0]!.size).toBe("1024");
    expect(result.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
  });

  it("returns an empty result when no files match", async () => {
    const result = await searchFiles({
      ownerId,
      query: "missing",
    });

    expect(result.items).toEqual([]);
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.totalPages).toBe(0);
  });

  it("uses the requested pagination values", async () => {
    countMock.mockResolvedValue(25);

    const result = await searchFiles({
      ownerId,
      query: "report",
      page: 2,
      limit: 5,
    });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 5,
        take: 5,
      }),
    );

    expect(result.pagination).toEqual({
      page: 2,
      limit: 5,
      total: 25,
      totalPages: 5,
    });
  });

  it("rejects an empty search query", async () => {
    await expect(
      searchFiles({ ownerId, query: "   " }),
    ).rejects.toMatchObject({
      message: "Search query cannot be empty",
      statusCode: 400,
    });

    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid page", async () => {
    await expect(
      searchFiles({
        ownerId,
        query: "report",
        page: 0,
      }),
    ).rejects.toMatchObject({
      message: "Page must be a positive integer",
      statusCode: 400,
    });
  });

  it("rejects a limit greater than 100", async () => {
    await expect(
      searchFiles({
        ownerId,
        query: "report",
        limit: 101,
      }),
    ).rejects.toMatchObject({
      message: "Limit must be an integer between 1 and 100",
      statusCode: 400,
    });
  });
});
