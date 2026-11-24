import { prisma } from "../config/database.js";
import { AppError } from "../utils/AppError.js";
import { logActivity } from "./activityService.js";
import { withActiveAccountLock } from "./accountLifecycleService.js";

interface CreateFolderInput {
  name: string;
  ownerId: string;
  parentId?: string | null;
}

export const createFolder = async ({
  name,
  ownerId,
  parentId,
}: CreateFolderInput) => {
  const normalizedName = name.trim();

  if (!normalizedName) {
    throw new AppError("Folder name cannot be empty", 400);
  }

  if (normalizedName.length > 255) {
    throw new AppError(
      "Folder name cannot exceed 255 characters",
      400
    );
  }

  if (
    normalizedName.includes("/") ||
    normalizedName.includes("\\") ||
    normalizedName.includes("\0") ||
    normalizedName === "." ||
    normalizedName === ".."
  ) {
    throw new AppError("Folder name contains invalid characters", 400);
  }

  const folder = await withActiveAccountLock(ownerId, async (tx) => {
    if (parentId) {
      const parentFolder = await tx.folder.findFirst({
        where: { id: parentId, ownerId },
        select: { id: true },
      });

      if (!parentFolder) throw new AppError("Parent folder not found", 404);
    }

    return tx.folder.create({
      data: { name: normalizedName, ownerId, parentId: parentId ?? null },
      select: {
        id: true,
        name: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  void logActivity({
    userId: ownerId,
    action: "FOLDER_CREATED",
    resourceType: "FOLDER",
    resourceId: folder.id,
    resourceName: folder.name,
  });

  return folder;
};

export const listFolders = async (
  ownerId: string,
  parentId?: string | null,
  {
    page = 1,
    limit = 100,
    sortBy = "createdAt",
    sortOrder = "desc",
  }: {
    page?: number;
    limit?: number;
    sortBy?: "name" | "createdAt" | "updatedAt";
    sortOrder?: "asc" | "desc";
  } = {},
) => {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new AppError("Page must be a positive integer", 400);
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError("Limit must be an integer between 1 and 100", 400);
  }
  if (!Number.isSafeInteger((page - 1) * limit)) {
    throw new AppError("Page is out of range", 400);
  }
  if (sortOrder !== "asc" && sortOrder !== "desc") {
    throw new AppError("sortOrder must be asc or desc", 400);
  }
  if (!["name", "createdAt", "updatedAt"].includes(sortBy)) {
    throw new AppError("Invalid sort field", 400);
  }

  const where = {
    ownerId,
    parentId: parentId ?? null,
  };
  const skip = (page - 1) * limit;
  const [folders, total] = await Promise.all([
    prisma.folder.findMany({
      where,
      orderBy: [{ [sortBy]: sortOrder }, { id: "asc" }],
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.folder.count({ where }),
  ]);

  return {
    items: folders,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const deleteFolder = async ({
  folderId,
  ownerId,
}: {
  folderId: string;
  ownerId: string;
}) => {
  const folder = await withActiveAccountLock(ownerId, async (tx) => {
    const existing = await tx.folder.findFirst({
      where: { id: folderId, ownerId },
      select: { id: true },
    });

    if (!existing) throw new AppError("Folder not found", 404);

    const [childFolder, file] = await Promise.all([
      tx.folder.findFirst({
        where: { parentId: folderId, ownerId },
        select: { id: true },
      }),
      tx.file.findFirst({
        where: { folderId, ownerId },
        select: { id: true },
      }),
    ]);

    if (childFolder || file) {
      throw new AppError(
        "Cannot delete a folder that contains files or subfolders",
        409,
      );
    }

    await tx.folder.delete({ where: { id: folderId } });
    return existing;
  });

  void logActivity({
    userId: ownerId,
    action: "FOLDER_DELETED",
    resourceType: "FOLDER",
    resourceId: folder.id,
    resourceName: folderId,
  });
};

interface RenameFolderInput {
  folderId: string;
  ownerId: string;
  name: string;
}

export const renameFolder = async ({
  folderId,
  ownerId,
  name,
}: RenameFolderInput) => {
  const normalizedName = name.trim();

  if (!normalizedName) {
    throw new AppError("Folder name cannot be empty", 400);
  }

  if (normalizedName.length > 255) {
    throw new AppError(
      "Folder name cannot exceed 255 characters",
      400
    );
  }

  if (
    normalizedName.includes("/") ||
    normalizedName.includes("\\") ||
    normalizedName.includes("\0") ||
    normalizedName === "." ||
    normalizedName === ".."
  ) {
    throw new AppError("Folder name contains invalid characters", 400);
  }

  const updatedFolder = await withActiveAccountLock(ownerId, async (tx) => {
    const folder = await tx.folder.findFirst({
      where: { id: folderId, ownerId },
      select: { id: true },
    });

    if (!folder) throw new AppError("Folder not found", 404);

    return tx.folder.update({
      where: { id: folderId },
      data: { name: normalizedName },
      select: {
        id: true,
        name: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  void logActivity({
    userId: ownerId,
    action: "FOLDER_RENAMED",
    resourceType: "FOLDER",
    resourceId: updatedFolder.id,
    resourceName: updatedFolder.name,
  });

  return updatedFolder;
};

export const moveFolder = async ({
  folderId,
  ownerId,
  parentId,
}: {
  folderId: string;
  ownerId: string;
  parentId: string | null;
}) => {
  const updatedFolder = await withActiveAccountLock(ownerId, async (tx) => {
    const folders = await tx.folder.findMany({
      where: { ownerId },
      select: {
        id: true,
        name: true,
        parentId: true,
      },
    });
    const folderById = new Map(folders.map((folder) => [folder.id, folder]));
    const folder = folderById.get(folderId);

    if (!folder) throw new AppError("Folder not found", 404);

    if (parentId !== null && !folderById.has(parentId)) {
      throw new AppError("Parent folder not found", 404);
    }

    const visited = new Set<string>();
    let ancestorId = parentId;

    while (ancestorId !== null) {
      if (ancestorId === folderId) {
        throw new AppError("A folder cannot be moved into itself or a descendant", 400);
      }

      if (visited.has(ancestorId)) {
        throw new AppError("Folder hierarchy is invalid", 409);
      }

      visited.add(ancestorId);
      ancestorId = folderById.get(ancestorId)?.parentId ?? null;
    }

    return tx.folder.update({
      where: { id: folderId },
      data: { parentId },
      select: {
        id: true,
        name: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  void logActivity({
    userId: ownerId,
    action: "FOLDER_MOVED",
    resourceType: "FOLDER",
    resourceId: updatedFolder.id,
    resourceName: updatedFolder.name,
    details: { parentId },
  });

  return updatedFolder;
};
