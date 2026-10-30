import { prisma } from "../config/database.js";
import { AppError } from "../utils/AppError.js";

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

  // If a parent is supplied, verify it belongs to this user.
  if (parentId) {
    const parentFolder = await prisma.folder.findFirst({
      where: {
        id: parentId,
        ownerId,
      },
      select: {
        id: true,
      },
    });

    if (!parentFolder) {
      throw new AppError(
        "Parent folder not found",
        404
      );
    }
  }

  return prisma.folder.create({
    data: {
      name: normalizedName,
      ownerId,
      parentId: parentId ?? null,
    },
    select: {
      id: true,
      name: true,
      parentId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
};

export const listFolders = async (
  ownerId: string,
  parentId?: string | null,
) => {
  return prisma.folder.findMany({
    where: {
      ownerId,
      parentId: parentId ?? null,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      name: true,
      parentId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
};


export const deleteFolder = async ({
  folderId,
  ownerId,
}: {
  folderId: string;
  ownerId: string;
}) => {
  const folder = await prisma.folder.findFirst({
    where: {
      id: folderId,
      ownerId,
    },
    select: {
      id: true,
    },
  });

  if (!folder) {
    throw new AppError("Folder not found", 404);
  }

  // Check whether the folder contains child folders or files.
  const [childFolder, file] = await Promise.all([
    prisma.folder.findFirst({
      where: {
        parentId: folderId,
        ownerId,
      },
      select: {
        id: true,
      },
    }),
    prisma.file.findFirst({
      where: {
        folderId,
        ownerId,
      },
      select: {
        id: true,
      },
    }),
  ]);

  if (childFolder || file) {
    throw new AppError(
      "Cannot delete a folder that contains files or subfolders",
      409
    );
  }

  await prisma.folder.delete({
    where: {
      id: folderId,
    },
  });
};
