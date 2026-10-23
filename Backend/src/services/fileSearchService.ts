import { prisma } from "../config/database.js";
import { AppError } from "../utils/AppError.js";

interface SearchFilesInput {
  ownerId: string;
  query: string;
  page?: number;
  limit?: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

export const searchFiles = async ({
  ownerId,
  query,
  page = DEFAULT_PAGE,
  limit = DEFAULT_LIMIT,
}: SearchFilesInput) => {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    throw new AppError("Search query cannot be empty", 400);
  }

  if (!Number.isInteger(page) || page < 1) {
    throw new AppError("Page must be a positive integer", 400);
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new AppError(
      `Limit must be an integer between 1 and ${MAX_LIMIT}`,
      400,
    );
  }

  const where = {
    ownerId,
    deletedAt: null,
    name: {
      contains: normalizedQuery,
      mode: "insensitive" as const,
    },
  };

  const skip = (page - 1) * limit;

  const [files, total] = await Promise.all([
    prisma.file.findMany({
      where,
      orderBy: { createdAt: "desc" },
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
