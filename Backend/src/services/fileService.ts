import { randomUUID } from "node:crypto";
import { prisma } from "../config/database.js";
import { AppError } from "../utils/AppError.js";
import {
  uploadObject,
  downloadObject,
  deleteObject,
} from "./storageService.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

interface UploadFileInput {
  ownerId: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  folderId?: string | null;
}

interface ListFilesInput {
  ownerId: string;
  folderId?: string | null;
}

interface GetFileForDownloadInput {
  fileId: string;
  ownerId: string;
}

interface RenameFileInput {
  fileId: string;
  ownerId: string;
  newName: string;
}

interface FileTrashInput {
  fileId: string;
  ownerId: string;
}

// Upload a new file.
export const uploadFile = async ({
  ownerId,
  originalName,
  mimeType,
  buffer,
  folderId,
}: UploadFileInput) => {
  const normalizedName = originalName.trim();

  if (!normalizedName) {
    throw new AppError("File name cannot be empty", 400);
  }

  if (normalizedName.length > 255) {
    throw new AppError("File name cannot exceed 255 characters", 400);
  }

  if (!buffer.length) {
    throw new AppError("Uploaded file is empty", 400);
  }

  if (buffer.length > MAX_FILE_SIZE) {
    throw new AppError("File size cannot exceed 10 MB", 413);
  }

  if (!mimeType || mimeType.length > 255) {
    throw new AppError("A valid content type is required", 400);
  }

  if (folderId) {
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
  }

  // Never use a user-supplied filename as the storage key.
  const storageKey = `${ownerId}/${randomUUID()}`;

  await uploadObject({
    key: storageKey,
    body: buffer,
    contentType: mimeType,
  });

  try {
    return await prisma.file.create({
      data: {
        name: normalizedName,
        originalName: normalizedName,
        storageKey,
        mimeType,
        size: BigInt(buffer.length),
        ownerId,
        folderId: folderId ?? null,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        mimeType: true,
        size: true,
        folderId: true,
        createdAt: true,
      },
    });
  } catch (error) {
    // Best-effort storage cleanup if database persistence fails.
    try {
      await deleteObject(storageKey);
    } catch {
      // Preserve the original database error.
    }

    throw error;
  }
};

// List active files, excluding files in Trash.
export const listFiles = async ({
  ownerId,
  folderId,
}: ListFilesInput) => {
  const files = await prisma.file.findMany({
    where: {
      ownerId,
      folderId: folderId ?? null,
      deletedAt: null,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      name: true,
      originalName: true,
      mimeType: true,
      size: true,
      folderId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return files.map((file) => ({
    ...file,
    size: file.size.toString(),
  }));
};

// Download an active file belonging to the authenticated user.
export const getFileForDownload = async ({
  fileId,
  ownerId,
}: GetFileForDownloadInput) => {
  const file = await prisma.file.findFirst({
    where: {
      id: fileId,
      ownerId,
      deletedAt: null,
    },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      size: true,
      storageKey: true,
    },
  });

  if (!file) {
    throw new AppError("File not found", 404);
  }

  const object = await downloadObject(file.storageKey);

  return {
    file: {
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size.toString(),
    },
    object,
  };
};

// Rename an active file.
export const renameFile = async ({
  fileId,
  ownerId,
  newName,
}: RenameFileInput) => {
  const normalizedName = newName.trim();

  if (!normalizedName) {
    throw new AppError("File name cannot be empty", 400);
  }

  if (normalizedName.length > 255) {
    throw new AppError("File name cannot exceed 255 characters", 400);
  }

  const file = await prisma.file.findFirst({
    where: {
      id: fileId,
      ownerId,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (!file) {
    throw new AppError("File not found", 404);
  }

  return prisma.file.update({
    where: {
      id: file.id,
    },
    data: {
      name: normalizedName,
      originalName: normalizedName,
    },
    select: {
      id: true,
      name: true,
      originalName: true,
      mimeType: true,
      size: true,
      folderId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
};

// Move an active file to Trash without deleting its storage object.
export const moveFileToTrash = async ({
  fileId,
  ownerId,
}: FileTrashInput) => {
  const file = await prisma.file.findFirst({
    where: {
      id: fileId,
      ownerId,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (!file) {
    throw new AppError("File not found", 404);
  }

  return prisma.file.update({
    where: {
      id: file.id,
    },
    data: {
      deletedAt: new Date(),
    },
    select: {
      id: true,
      name: true,
      deletedAt: true,
    },
  });
};

// List files in Trash for the authenticated user.
export const listTrashedFiles = async ({
  ownerId,
}: {
  ownerId: string;
}) => {
  const files = await prisma.file.findMany({
    where: {
      ownerId,
      deletedAt: {
        not: null,
      },
    },
    orderBy: {
      deletedAt: "desc",
    },
    select: {
      id: true,
      name: true,
      originalName: true,
      mimeType: true,
      size: true,
      folderId: true,
      createdAt: true,
      deletedAt: true,
    },
  });

  return files.map((file) => ({
    ...file,
    size: file.size.toString(),
  }));
};

// Restore a trashed file.
export const restoreFileFromTrash = async ({
  fileId,
  ownerId,
}: FileTrashInput) => {
  const file = await prisma.file.findFirst({
    where: {
      id: fileId,
      ownerId,
      deletedAt: {
        not: null,
      },
    },
    select: {
      id: true,
    },
  });

  if (!file) {
    throw new AppError("Trashed file not found", 404);
  }

  return prisma.file.update({
    where: {
      id: file.id,
    },
    data: {
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      originalName: true,
      mimeType: true,
      size: true,
      folderId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
};

// Permanently delete a file that is already in Trash.
export const permanentlyDeleteFile = async ({
  fileId,
  ownerId,
}: FileTrashInput) => {
  const file = await prisma.file.findFirst({
    where: {
      id: fileId,
      ownerId,
      deletedAt: {
        not: null,
      },
    },
    select: {
      id: true,
      storageKey: true,
    },
  });

  if (!file) {
    throw new AppError("Trashed file not found", 404);
  }

  // Delete the storage object first. If this fails, preserve the DB record.
  await deleteObject(file.storageKey);

  // ShareLink records are removed by the Prisma schema's cascade relation.
  // If this DB operation fails, the file remains trashed and can be retried.
  return prisma.file.delete({
    where: {
      id: file.id,
    },
    select: {
      id: true,
    },
  });
};