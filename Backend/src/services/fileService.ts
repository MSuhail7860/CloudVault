import { randomUUID } from "node:crypto";
import { prisma } from "../config/database.js";
import { AppError } from "../utils/AppError.js";
import {
  uploadObject,
  downloadObject,
  deleteObject,
} from "./storageService.js";
import { logActivity } from "./activityService.js";
import { enqueueFileProcessingJob } from "../jobs/queues.js";
import { withActiveAccountLock } from "./accountLifecycleService.js";
import {
  reserveStorageObject,
  scheduleStorageObjectCleanup,
  startStorageObjectReservationHeartbeat,
} from "./storageObjectTaskService.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const IMAGE_SIGNATURES: Readonly<Record<string, (buffer: Buffer) => boolean>> = {
  "image/png": (buffer) =>
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
  "image/jpeg": (buffer) =>
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff,
  "image/gif": (buffer) =>
    buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
    buffer.subarray(0, 6).toString("ascii") === "GIF89a",
  "image/webp": (buffer) =>
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP",
};

const isTextContent = (buffer: Buffer): boolean => {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
};

interface UploadFileInput {
  ownerId: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  folderId?: string | null;
  abortSignal?: AbortSignal;
}

interface ListFilesInput {
  ownerId: string;
  folderId?: string | null;
  query?: string;
  mimeType?: string;
  page?: number;
  limit?: number;
  sortBy?: "name" | "size" | "createdAt" | "updatedAt" | "mimeType";
  sortOrder?: "asc" | "desc";
}

interface GetFileForDownloadInput {
  fileId: string;
  ownerId: string;
}

interface DownloadFileVersionInput {
  fileId: string;
  versionId: string;
  ownerId: string;
}

interface RenameFileInput {
  fileId: string;
  ownerId: string;
  newName: string;
}

interface MoveFileInput {
  fileId: string;
  ownerId: string;
  folderId: string | null;
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
  abortSignal?: AbortSignal;
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

  if (
    normalizedName.includes("/") ||
    normalizedName.includes("\\") ||
    normalizedName.includes("\0") ||
    normalizedName === "." ||
    normalizedName === ".."
  ) {
    throw new AppError("File name contains invalid characters", 400);
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

  if (mimeType.startsWith("image/")) {
    const matchesSignature = IMAGE_SIGNATURES[mimeType]?.(buffer) ?? false;
    if (!matchesSignature) {
      throw new AppError("Image content does not match its declared type", 400);
    }
  } else if (mimeType === "application/pdf") {
    if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new AppError("PDF content does not match its declared type", 400);
    }
  } else if (mimeType.startsWith("text/")) {
    if (!isTextContent(buffer)) {
      throw new AppError("Text content is not valid UTF-8", 400);
    }
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

const scheduleFailedStorageCleanup = async (reservationId: string): Promise<void> => {
  try {
    await scheduleStorageObjectCleanup(reservationId);
  } catch (cleanupError) {
    // The reservation remains durable in UPLOADING state and will be moved to
    // cleanup by lease expiry recovery. Preserve the original operation error.
    console.error(JSON.stringify({
      event: "storage_cleanup_schedule_failed",
      reservationId,
      errorName:
        cleanupError instanceof Error ? cleanupError.name : "UnknownError",
    }));
  }
};

// Upload a new file.
export const uploadFile = async ({
  ownerId,
  originalName,
  mimeType,
  buffer,
  folderId,
  abortSignal,
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
  const reservationId = await reserveStorageObject(ownerId, storageKey);
  const reservationHeartbeat = startStorageObjectReservationHeartbeat(reservationId);

  try {
    await uploadObject({
      key: storageKey,
      body: buffer,
      contentType: mimeType,
      abortSignal,
    });
    if (abortSignal?.aborted) {
      throw new AppError("Upload request timed out", 408);
    }
  } catch (error) {
    await scheduleFailedStorageCleanup(reservationId);
    throw error;
  } finally {
    reservationHeartbeat.stop();
  }

  let file: {
    id: string;
    name: string;
    originalName: string;
    mimeType: string;
    size: bigint;
    folderId: string | null;
    createdAt: Date;
  };

  try {
    file = await withActiveAccountLock(ownerId, (tx) => {
      if (abortSignal?.aborted) {
        throw new AppError("Upload request timed out", 408);
      }
      return tx.file.create({
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
      }).then(async (createdFile) => {
        if (abortSignal?.aborted) {
          throw new AppError("Upload request timed out", 408);
        }
        const reservation = await tx.storageObjectTask.deleteMany({
          where: {
            id: reservationId,
            userId: ownerId,
            status: "UPLOADING",
          },
        });

        if (reservation.count !== 1) {
          throw new AppError("Storage reservation is unavailable", 409);
        }

        return createdFile;
      });
    });
  } catch (error) {
    // The database record was not created, so remove the uploaded object.
    await scheduleFailedStorageCleanup(reservationId);

    throw error;
  }

  // Enqueue processing only after the file record has been committed.
  // A queue failure must not delete the successfully-created file/object.
  try {
    await enqueueFileProcessingJob(file.id);
  } catch (error) {
    console.error(JSON.stringify({
      event: "file_processing_enqueue_failed",
      fileId: file.id,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }));
  }

  void logActivity({
    userId: ownerId,
    action: "FILE_UPLOADED",
    resourceType: "FILE",
    resourceId: file.id,
    resourceName: file.name,
  });

  return {
    ...file,
    size: file.size.toString(),
  };
};

// List active files, excluding files in Trash.
export const listFiles = async ({
  ownerId,
  folderId,
  query,
  mimeType,
  page = 1,
  limit = 100,
  sortBy = "createdAt",
  sortOrder = "desc",
}: ListFilesInput) => {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new AppError("Page must be a positive integer", 400);
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError("Limit must be an integer between 1 and 100", 400);
  }
  if (!Number.isSafeInteger((page - 1) * limit)) {
    throw new AppError("Page is out of range", 400);
  }
  if (!["name", "size", "createdAt", "updatedAt", "mimeType"].includes(sortBy)) {
    throw new AppError("Invalid sort field", 400);
  }
  if (sortOrder !== "asc" && sortOrder !== "desc") {
    throw new AppError("sortOrder must be asc or desc", 400);
  }

  const where = {
    ownerId,
    folderId: folderId ?? null,
    deletedAt: null,
    ...(query?.trim()
      ? { name: { contains: query.trim(), mode: "insensitive" as const } }
      : {}),
    ...(mimeType
      ? {
          mimeType: mimeType.endsWith("/*")
            ? { startsWith: mimeType.slice(0, -1) }
            : mimeType,
        }
      : {}),
  };
  const orderBy = [
    { [sortBy]: sortOrder },
    { id: "asc" as const },
  ];
  const skip = (page - 1) * limit;

  const [files, total] = await Promise.all([
    prisma.file.findMany({
      where,
      orderBy,
      skip,
      take: limit,
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
    }),
    prisma.file.count({ where }),
  ]);

  return {
    items: files.map((file) => ({
      ...file,
      size: file.size.toString(),
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
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
      name: true,
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

  void logActivity({
    userId: ownerId,
    action: "FILE_DOWNLOADED",
    resourceType: "FILE",
    resourceId: file.id,
    resourceName: file.name,
  });

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

// Download a specific historical version of an active file.
export const downloadFileVersion = async ({
  fileId,
  versionId,
  ownerId,
}: DownloadFileVersionInput) => {
  const file = await prisma.file.findFirst({
    where: {
      id: fileId,
      ownerId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      originalName: true,
    },
  });

  if (!file) {
    throw new AppError("File not found", 404);
  }

  const version = await prisma.fileVersion.findFirst({
    where: {
      id: versionId,
      fileId: file.id,
    },
    select: {
      id: true,
      version: true,
      mimeType: true,
      size: true,
      storageKey: true,
    },
  });

  if (!version) {
    throw new AppError("File version not found", 404);
  }

  const object = await downloadObject(version.storageKey);

  void logActivity({
    userId: ownerId,
    action: "FILE_DOWNLOADED",
    resourceType: "FILE",
    resourceId: file.id,
    resourceName: `${file.name} (v${version.version})`,
  });

  return {
    version: {
      id: version.id,
      version: version.version,
      mimeType: version.mimeType,
      size: version.size.toString(),
    },
    file: {
      id: file.id,
      name: file.name,
      originalName: file.originalName,
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

  if (
    normalizedName.includes("/") ||
    normalizedName.includes("\\") ||
    normalizedName.includes("\0") ||
    normalizedName === "." ||
    normalizedName === ".."
  ) {
    throw new AppError("File name contains invalid characters", 400);
  }

  const updatedFile = await withActiveAccountLock(ownerId, async (tx) => {
    const file = await tx.file.findFirst({
      where: { id: fileId, ownerId, deletedAt: null },
      select: { id: true },
    });

    if (!file) throw new AppError("File not found", 404);

    return tx.file.update({
      where: { id: file.id },
      data: { name: normalizedName, originalName: normalizedName },
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
  });

  void logActivity({
    userId: ownerId,
    action: "FILE_RENAMED",
    resourceType: "FILE",
    resourceId: updatedFile.id,
    resourceName: updatedFile.name,
  });

  return {
    ...updatedFile,
    size: updatedFile.size.toString(),
  };
};

// Move an active file into a folder or back to the root.
export const moveFile = async ({
  fileId,
  ownerId,
  folderId,
}: MoveFileInput) => {
  const updatedFile = await withActiveAccountLock(ownerId, async (tx) => {
    const file = await tx.file.findFirst({
      where: { id: fileId, ownerId, deletedAt: null },
      select: { id: true },
    });

    if (!file) throw new AppError("File not found", 404);

    if (folderId !== null) {
      const folder = await tx.folder.findFirst({
        where: { id: folderId, ownerId },
        select: { id: true },
      });

      if (!folder) throw new AppError("Folder not found", 404);
    }

    return tx.file.update({
      where: { id: file.id },
      data: { folderId },
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
  });

  void logActivity({
    userId: ownerId,
    action: "FILE_MOVED",
    resourceType: "FILE",
    resourceId: updatedFile.id,
    resourceName: updatedFile.name,
  });

  return {
    ...updatedFile,
    size: updatedFile.size.toString(),
  };
};

// Move an active file to Trash without deleting its storage objects.
export const moveFileToTrash = async ({
  fileId,
  ownerId,
}: FileTrashInput) => {
  const trashedFile = await withActiveAccountLock(ownerId, async (tx) => {
    const file = await tx.file.findFirst({
      where: { id: fileId, ownerId, deletedAt: null },
      select: { id: true },
    });

    if (!file) throw new AppError("File not found", 404);

    return tx.file.update({
      where: { id: file.id },
      data: { deletedAt: new Date() },
      select: { id: true, name: true, deletedAt: true },
    });
  });

  void logActivity({
    userId: ownerId,
    action: "FILE_DELETED",
    resourceType: "FILE",
    resourceId: trashedFile.id,
    resourceName: trashedFile.name,
  });

  return trashedFile;
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
  const restoredFile = await withActiveAccountLock(ownerId, async (tx) => {
    const file = await tx.file.findFirst({
      where: { id: fileId, ownerId, deletedAt: { not: null } },
      select: { id: true },
    });

    if (!file) throw new AppError("Trashed file not found", 404);

    return tx.file.update({
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
  });

  void logActivity({
    userId: ownerId,
    action: "FILE_RESTORED",
    resourceType: "FILE",
    resourceId: restoredFile.id,
    resourceName: restoredFile.name,
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
  abortSignal,
}: UploadFileVersionInput) => {
  const file = await prisma.file.findFirst({
    where: {
      id: fileId,
      ownerId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      storageKey: true,
      mimeType: true,
      size: true,
    },
  });

  if (!file) {
    throw new AppError("File not found", 404);
  }

  const normalizedName = validateUploadedContent(
    originalName,
    mimeType,
    buffer,
  );

  const newStorageKey = `${ownerId}/${randomUUID()}`;
  const reservationId = await reserveStorageObject(ownerId, newStorageKey);
  const reservationHeartbeat = startStorageObjectReservationHeartbeat(reservationId);

  try {
    await uploadObject({
      key: newStorageKey,
      body: buffer,
      contentType: mimeType,
      abortSignal,
    });
    if (abortSignal?.aborted) {
      throw new AppError("Upload request timed out", 408);
    }
  } catch (error) {
    await scheduleFailedStorageCleanup(reservationId);
    throw error;
  } finally {
    reservationHeartbeat.stop();
  }

  try {
    const result = await withActiveAccountLock(ownerId, async (tx) => {
      if (abortSignal?.aborted) {
        throw new AppError("Upload request timed out", 408);
      }
      const currentFile = await tx.file.findFirst({
        where: {
          id: fileId,
          ownerId,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
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

      if (abortSignal?.aborted) {
        throw new AppError("Upload request timed out", 408);
      }

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

      if (abortSignal?.aborted) {
        throw new AppError("Upload request timed out", 408);
      }

      const reservation = await tx.storageObjectTask.deleteMany({
        where: {
          id: reservationId,
          userId: ownerId,
          status: "UPLOADING",
        },
      });

      if (reservation.count !== 1) {
        throw new AppError("Storage reservation is unavailable", 409);
      }

      return { version, file: updatedFile };
    });

    void logActivity({
      userId: ownerId,
      action: "FILE_VERSION_CREATED",
      resourceType: "FILE",
      resourceId: file.id,
      resourceName: file.name,
      details: { version: result.version.version },
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
    await scheduleFailedStorageCleanup(reservationId);

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
      name: true,
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
      version: true,
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
  const reservationId = await reserveStorageObject(ownerId, restoredStorageKey);
  const reservationHeartbeat = startStorageObjectReservationHeartbeat(reservationId);

  try {
    await uploadObject({
      key: restoredStorageKey,
      body: previousContent,
      contentType: versionToRestore.mimeType,
    });
  } catch (error) {
    await scheduleFailedStorageCleanup(reservationId);
    throw error;
  } finally {
    reservationHeartbeat.stop();
  }

  try {
    const result = await withActiveAccountLock(ownerId, async (tx) => {
      const currentFile = await tx.file.findFirst({
        where: {
          id: fileId,
          ownerId,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
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

      const reservation = await tx.storageObjectTask.deleteMany({
        where: {
          id: reservationId,
          userId: ownerId,
          status: "UPLOADING",
        },
      });

      if (reservation.count !== 1) {
        throw new AppError("Storage reservation is unavailable", 409);
      }

      return { savedCurrentVersion, file: updatedFile };
    });

    void logActivity({
      userId: ownerId,
      action: "FILE_VERSION_CREATED",
      resourceType: "FILE",
      resourceId: file.id,
      resourceName: file.name,
      details: { restoredFromVersion: versionToRestore.version },
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
    await scheduleFailedStorageCleanup(reservationId);

    throw error;
  }
};

// Permanently delete a trashed file and all its stored historical versions.
export const permanentlyDeleteFile = async ({
  fileId,
  ownerId,
}: FileTrashInput) => {
  const file = await withActiveAccountLock(ownerId, (tx) =>
    tx.file.findFirst({
      where: { id: fileId, ownerId, deletedAt: { not: null } },
      select: {
        id: true,
        name: true,
        storageKey: true,
        versions: { select: { storageKey: true } },
      },
    }),
  );

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

  const deleted = await withActiveAccountLock(ownerId, (tx) =>
    tx.file.delete({
      where: { id: file.id },
      select: { id: true },
    }),
  );

  void logActivity({
    userId: ownerId,
    action: "FILE_PERMANENTLY_DELETED",
    resourceType: "FILE",
    resourceId: file.id,
    resourceName: file.name,
  });

  return deleted;
};
