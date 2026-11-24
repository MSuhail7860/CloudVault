import { prisma } from "../config/database.js";
import { AppError } from "../utils/AppError.js";

interface SearchFilesInput {
  ownerId: string;
  query: string;
  page?: number;
  limit?: number;
  folderId?: string | null;
  mimeType?: string;
  sortBy?: "name" | "size" | "createdAt" | "updatedAt" | "mimeType";
  sortOrder?: "asc" | "desc";
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

export const searchFiles = async ({
  ownerId,
  query,
  page = DEFAULT_PAGE,
  limit = DEFAULT_LIMIT,
  folderId,
  mimeType,
  sortBy = "createdAt",
  sortOrder = "desc",
}: SearchFilesInput) => {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    throw new AppError("Search query cannot be empty", 400);
  }

  if (!Number.isSafeInteger(page) || page < 1) {
    throw new AppError("Page must be a positive integer", 400);
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new AppError(
      `Limit must be an integer between 1 and ${MAX_LIMIT}`,
      400,
    );
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
    deletedAt: null,
    ...(folderId !== undefined ? { folderId } : {}),
    ...(mimeType
      ? {
          mimeType: mimeType.endsWith("/*")
            ? { startsWith: mimeType.slice(0, -1) }
            : mimeType,
        }
      : {}),
    name: {
      contains: normalizedQuery,
      mode: "insensitive" as const,
    },
  };

  const skip = (page - 1) * limit;

  const [files, total] = await Promise.all([
    prisma.file.findMany({
      where,
      orderBy: [{ [sortBy]: sortOrder }, { id: "asc" }],
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
