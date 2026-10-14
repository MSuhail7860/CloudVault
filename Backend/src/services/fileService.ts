import { randomUUID } from "node:crypto";
import { prisma } from "../config/database.js";
import { AppError } from "../utils/AppError.js";
import { uploadObject, deleteObject } from "./storageService.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

interface UploadFileInput {
  ownerId: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  folderId?: string | null;
}

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

  // Never use the user-supplied filename as the storage key.
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
    // Best-effort cleanup if database persistence fails.
    try {
      await deleteObject(storageKey);
    } catch {
      // Preserve the original database error.
    }

    throw error;
  }
};


interface ListFilesInput {
  ownerId: string;
  folderId?: string | null;
}

export const listFiles = async ({
  ownerId,
  folderId,
}: ListFilesInput) => {
  const files = await prisma.file.findMany({
    where: {
      ownerId,
      folderId: folderId ?? null,
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