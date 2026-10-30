import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/database.js", () => ({
  prisma: {
    folder: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    file: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "../../config/database.js";
import {
  createFolder,
  listFolders,
  deleteFolder,
} from "../folderService.js";

const db = vi.mocked(prisma);

const ownerId = "user-1";
const folderId = "folder-1";

const folder = {
  id: folderId,
  name: "Documents",
  parentId: null,
  createdAt: new Date("2026-10-01T10:00:00Z"),
  updatedAt: new Date("2026-10-01T10:00:00Z"),
};

const expectAppError = async (
  promise: Promise<unknown>,
  message: string,
  statusCode: number,
) => {
  const error = await promise.catch((caught: unknown) => caught);

  expect(error).toMatchObject({ message, statusCode });
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("createFolder", () => {
  it("creates a folder with a trimmed name", async () => {
    vi.mocked(db.folder.create).mockResolvedValue(folder as never);

    const result = await createFolder({
      name: " Documents ",
      ownerId,
    });

    expect(db.folder.create).toHaveBeenCalledWith({
      data: {
        name: "Documents",
        ownerId,
        parentId: null,
      },
      select: {
        id: true,
        name: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    expect(result).toEqual(folder);
  });

  it("creates a nested folder when the parent belongs to the user", async () => {
    vi.mocked(db.folder.findFirst).mockResolvedValue({
      id: "parent-1",
    } as never);

    vi.mocked(db.folder.create).mockResolvedValue({
      ...folder,
      parentId: "parent-1",
    } as never);

    await createFolder({
      name: "Projects",
      ownerId,
      parentId: "parent-1",
    });

    expect(db.folder.findFirst).toHaveBeenCalledWith({
      where: {
        id: "parent-1",
        ownerId,
      },
      select: { id: true },
    });

    expect(db.folder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          parentId: "parent-1",
          ownerId,
        }),
      }),
    );
  });

  it("rejects an empty folder name", async () => {
    await expectAppError(
      createFolder({ name: "   ", ownerId }),
      "Folder name cannot be empty",
      400,
    );

    expect(db.folder.create).not.toHaveBeenCalled();
  });

  it("rejects a folder name longer than 255 characters", async () => {
    await expectAppError(
      createFolder({ name: "a".repeat(256), ownerId }),
      "Folder name cannot exceed 255 characters",
      400,
    );

    expect(db.folder.create).not.toHaveBeenCalled();
  });

  it("rejects a parent folder that does not belong to the user", async () => {
    vi.mocked(db.folder.findFirst).mockResolvedValue(null);

    await expectAppError(
      createFolder({
        name: "Projects",
        ownerId,
        parentId: "other-users-folder",
      }),
      "Parent folder not found",
      404,
    );

    expect(db.folder.create).not.toHaveBeenCalled();
  });
});

describe("listFolders", () => {
  it("lists root folders belonging to the requested user", async () => {
    vi.mocked(db.folder.findMany).mockResolvedValue([
      folder,
    ] as never);

    const result = await listFolders(ownerId);

    expect(db.folder.findMany).toHaveBeenCalledWith({
      where: {
        ownerId,
        parentId: null,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    expect(result).toEqual([folder]);
  });

  it("lists child folders for a specified parent", async () => {
    const childFolder = {
      ...folder,
      id: "child-folder-1",
      name: "Projects",
      parentId: folderId,
    };

    vi.mocked(db.folder.findMany).mockResolvedValue([
      childFolder,
    ] as never);

    const result = await listFolders(ownerId, folderId);

    expect(db.folder.findMany).toHaveBeenCalledWith({
      where: {
        ownerId,
        parentId: folderId,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    expect(result).toEqual([childFolder]);
  });

  it("returns an empty list when the user has no folders", async () => {
    vi.mocked(db.folder.findMany).mockResolvedValue([]);

    const result = await listFolders(ownerId);

    expect(result).toEqual([]);
  });
});

describe("deleteFolder", () => {
  it("deletes an empty folder belonging to the user", async () => {
    vi.mocked(db.folder.findFirst)
      .mockResolvedValueOnce({ id: folderId } as never)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    vi.mocked(db.folder.delete).mockResolvedValue(folder as never);

    await deleteFolder({ folderId, ownerId });

    expect(db.folder.findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: folderId, ownerId },
      select: { id: true },
    });

    expect(db.folder.findFirst).toHaveBeenNthCalledWith(2, {
      where: { parentId: folderId, ownerId },
      select: { id: true },
    });

    expect(db.file.findFirst).toHaveBeenCalledWith({
      where: { folderId, ownerId },
      select: { id: true },
    });

    expect(db.folder.delete).toHaveBeenCalledWith({
      where: { id: folderId },
    });
  });

  it("rejects a folder that does not belong to the user", async () => {
    vi.mocked(db.folder.findFirst).mockResolvedValue(null);

    await expectAppError(
      deleteFolder({ folderId, ownerId }),
      "Folder not found",
      404,
    );

    expect(db.file.findFirst).not.toHaveBeenCalled();
    expect(db.folder.delete).not.toHaveBeenCalled();
  });

  it("rejects deletion when the folder contains a subfolder", async () => {
    vi.mocked(db.folder.findFirst)
      .mockResolvedValueOnce({ id: folderId } as never)
      .mockResolvedValueOnce({ id: "child-folder" } as never);

    vi.mocked(db.file.findFirst).mockResolvedValue(null);

    await expectAppError(
      deleteFolder({ folderId, ownerId }),
      "Cannot delete a folder that contains files or subfolders",
      409,
    );

    expect(db.folder.delete).not.toHaveBeenCalled();
  });

  it("rejects deletion when the folder contains a file", async () => {
    vi.mocked(db.folder.findFirst)
      .mockResolvedValueOnce({ id: folderId } as never)
      .mockResolvedValueOnce(null);

    vi.mocked(db.file.findFirst).mockResolvedValue({
      id: "file-1",
    } as never);

    await expectAppError(
      deleteFolder({ folderId, ownerId }),
      "Cannot delete a folder that contains files or subfolders",
      409,
    );

    expect(db.folder.delete).not.toHaveBeenCalled();
  });
});
