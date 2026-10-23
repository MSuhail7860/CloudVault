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

interface UploadFileVersionInput {
  fileId: string;
  ownerId: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}

interface ListFileVersionsInput {
  fileId: string;
  ownerId: string;
}

interface RestoreFileVersionInput {
  fileId: string;
  versionId: string;
  ownerId: string;
}

const validateUploadedContent = (
  originalName: string,
  mimeType: string,
  buffer: Buffer,
) => {
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

  return normalizedName;
};

const downloadObjectAsBuffer = async (key: string): Promise<Buffer> => {
  const response = await downloadObject(key);

  if (!response.Body) {
    throw new AppError("File content is unavailable in storage", 500);
  }

  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
};

// Upload a new file.
export const uploadFile = async ({
  ownerId,
  originalName,
  mimeType,
  buffer,
  folderId,
}: UploadFileInput) => {
  const normalizedName = validateUploadedContent(
    originalName,
    mimeType,
    buffer,
  );

  if (folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: folderId, ownerId },
      select: { id: true },
    });

    if (!folder) {
      throw new AppError("Folder not found", 404);
    }
  }

  const storageKey = `${ownerId}/${randomUUID()}`;

  await uploadObject({
    key: storageKey,
    body: buffer,
    contentType: mimeType,
  });

  try {
    const file = await prisma.file.create({
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

    return {
      ...file,
      size: file.size.toString(),
    };
  } catch (error) {
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
    orderBy: { createdAt: "desc" },
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
    select: { id: true },
  });

  if (!file) {
    throw new AppError("File not found", 404);
  }

  return prisma.file.update({
    where: { id: file.id },
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
  }).then((updatedFile) => ({
    ...updatedFile,
    size: updatedFile.size.toString(),
  }));
};

// Move an active file to Trash without deleting its storage objects.
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
    select: { id: true },
  });

  if (!file) {
    throw new AppError("File not found", 404);
  }

  return prisma.file.update({
    where: { id: file.id },
    data: { deletedAt: new Date() },
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
      deletedAt: { not: null },
    },
    orderBy: { deletedAt: "desc" },
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
      deletedAt: { not: null },
    },
    select: { id: true },
  });

  if (!file) {
    throw new AppError("Trashed file not found", 404);
  }

  const restoredFile = await prisma.file.update({
    where: { id: file.id },
    data: { deletedAt: null },
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

  return {
    ...restoredFile,
    size: restoredFile.size.toString(),
  };
};

// Upload a new revision while preserving the existing file ID.
export const uploadFileVersion = async ({
  fileId,
  ownerId,
  originalName,
  mimeType,
  buffer,
}: UploadFileVersionInput) => {
  const normalizedName = validateUploadedContent(
    originalName,
    mimeType,
    buffer,
  );

  const file = await prisma.file.findFirst({
    where: {
      id: fileId,
      ownerId,
      deletedAt: null,
    },
    select: {
      id: true,
      storageKey: true,
      mimeType: true,
      size: true,
    },
  });

  if (!file) {
    throw new AppError("File not found", 404);
  }

  const newStorageKey = `${ownerId}/${randomUUID()}`;

  // Upload new content before changing the database.
  await uploadObject({
    key: newStorageKey,
    body: buffer,
    contentType: mimeType,
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Recheck ownership and active status inside the transaction.
      const currentFile = await tx.file.findFirst({
        where: {
          id: fileId,
          ownerId,
          deletedAt: null,
        },
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          size: true,
        },
      });

      if (!currentFile) {
        throw new AppError("File not found", 404);
      }

      const latestVersion = await tx.fileVersion.findFirst({
        where: { fileId },
        orderBy: { version: "desc" },
        select: { version: true },
      });

      const nextVersion = (latestVersion?.version ?? 0) + 1;

      // Preserve the old storage key as the historical version.
      const version = await tx.fileVersion.create({
        data: {
          fileId,
          version: nextVersion,
          storageKey: currentFile.storageKey,
          mimeType: currentFile.mimeType,
          size: currentFile.size,
        },
        select: {
          id: true,
          version: true,
          mimeType: true,
          size: true,
          createdAt: true,
        },
      });

      const updatedFile = await tx.file.update({
        where: { id: fileId },
        data: {
          name: normalizedName,
          originalName: normalizedName,
          storageKey: newStorageKey,
          mimeType,
          size: BigInt(buffer.length),
        },
        select: {
          id: true,
          name: true,
          originalName: true,
          mimeType: true,
          size: true,
          updatedAt: true,
        },
      });

      return { version, file: updatedFile };
    });

    return {
      version: {
        ...result.version,
        size: result.version.size.toString(),
      },
      file: {
        ...result.file,
        size: result.file.size.toString(),
      },
    };
  } catch (error) {
    try {
      await deleteObject(newStorageKey);
    } catch {
      // Preserve the original database error.
    }

    throw error;
  }
};

// List saved historical versions for an active file.
export const listFileVersions = async ({
  fileId,
  ownerId,
}: ListFileVersionsInput) => {
  const file = await prisma.file.findFirst({
    where: {
      id: fileId,
      ownerId,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!file) {
    throw new AppError("File not found", 404);
  }

  const versions = await prisma.fileVersion.findMany({
    where: { fileId: file.id },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      mimeType: true,
      size: true,
      createdAt: true,
    },
  });

  return versions.map((version) => ({
    ...version,
    size: version.size.toString(),
  }));
};

// Restore a saved version without discarding the current content.
export const restoreFileVersion = async ({
  fileId,
  versionId,
  ownerId,
}: RestoreFileVersionInput) => {
  const file = await prisma.file.findFirst({
    where: {
      id: fileId,
      ownerId,
      deletedAt: null,
    },
    select: {
      id: true,
      storageKey: true,
      mimeType: true,
      size: true,
    },
  });

  if (!file) {
    throw new AppError("File not found", 404);
  }

  const versionToRestore = await prisma.fileVersion.findFirst({
    where: {
      id: versionId,
      fileId: file.id,
    },
    select: {
      id: true,
      storageKey: true,
      mimeType: true,
      size: true,
    },
  });

  if (!versionToRestore) {
    throw new AppError("File version not found", 404);
  }

  // Copy the selected historical content into a fresh current storage key.
  const previousContent = await downloadObjectAsBuffer(
    versionToRestore.storageKey,
  );
  const restoredStorageKey = `${ownerId}/${randomUUID()}`;

  await uploadObject({
    key: restoredStorageKey,
    body: previousContent,
    contentType: versionToRestore.mimeType,
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const currentFile = await tx.file.findFirst({
        where: {
          id: fileId,
          ownerId,
          deletedAt: null,
        },
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          size: true,
        },
      });

      if (!currentFile) {
        throw new AppError("File not found", 404);
      }

      // Keep the content being replaced as a new historical version.
      const latestVersion = await tx.fileVersion.findFirst({
        where: { fileId },
        orderBy: { version: "desc" },
        select: { version: true },
      });

      const nextVersion = (latestVersion?.version ?? 0) + 1;

      const savedCurrentVersion = await tx.fileVersion.create({
        data: {
          fileId,
          version: nextVersion,
          storageKey: currentFile.storageKey,
          mimeType: currentFile.mimeType,
          size: currentFile.size,
        },
        select: {
          id: true,
          version: true,
          mimeType: true,
          size: true,
          createdAt: true,
        },
      });

      const updatedFile = await tx.file.update({
        where: { id: fileId },
        data: {
          storageKey: restoredStorageKey,
          mimeType: versionToRestore.mimeType,
          size: versionToRestore.size,
        },
        select: {
          id: true,
          name: true,
          originalName: true,
          mimeType: true,
          size: true,
          updatedAt: true,
        },
      });

      return { savedCurrentVersion, file: updatedFile };
    });

    return {
      savedCurrentVersion: {
        ...result.savedCurrentVersion,
        size: result.savedCurrentVersion.size.toString(),
      },
      file: {
        ...result.file,
        size: result.file.size.toString(),
      },
    };
  } catch (error) {
    try {
      await deleteObject(restoredStorageKey);
    } catch {
      // Preserve the original database error.
    }

    throw error;
  }
};

// Permanently delete a trashed file and all its stored historical versions.
export const permanentlyDeleteFile = async ({
  fileId,
  ownerId,
}: FileTrashInput) => {
  const file = await prisma.file.findFirst({
    where: {
      id: fileId,
      ownerId,
      deletedAt: { not: null },
    },
    select: {
      id: true,
      storageKey: true,
      versions: {
        select: { storageKey: true },
      },
    },
  });

  if (!file) {
    throw new AppError("Trashed file not found", 404);
  }

  // Remove all associated objects before deleting the database record.
  // If storage deletion fails, keep the trashed file record for retry.
  const storageKeys = [
    ...new Set([
      file.storageKey,
      ...file.versions.map((version) => version.storageKey),
    ]),
  ];

  for (const key of storageKeys) {
    await deleteObject(key);
  }

  return prisma.file.delete({
    where: { id: file.id },
    select: { id: true },
  });
};
