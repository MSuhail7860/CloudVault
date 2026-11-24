import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { searchFiles as searchFilesService } from "../services/fileSearchService.js";

const parsePositiveInteger = (
  value: unknown,
): number | undefined | null => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    return null;
  }

  return parsed;
};

export const searchFiles = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({
        success: false,
        message: "Authentication is required",
      });
      return;
    }

    const { q } = req.query;

    if (typeof q !== "string" || !q.trim()) {
      res.status(400).json({
        success: false,
        message: "A non-empty search query is required using 'q'",
      });
      return;
    }
    if (q.length > 255) {
      res.status(400).json({
        success: false,
        message: "Search query cannot exceed 255 characters",
      });
      return;
    }

    const page = parsePositiveInteger(req.query.page);
    const limit = parsePositiveInteger(req.query.limit);
    const { sortBy, sortOrder, mimeType, folderId } = req.query;

    if (page === null) {
      res.status(400).json({
        success: false,
        message: "page must be a positive integer",
      });
      return;
    }

    if (limit === null) {
      res.status(400).json({
        success: false,
        message: "limit must be a positive integer",
      });
      return;
    }

    if (limit !== undefined && limit > 100) {
      res.status(400).json({
        success: false,
        message: "limit cannot exceed 100",
      });
      return;
    }

    const allowedSortBy = ["name", "size", "createdAt", "updatedAt", "mimeType"];
    if (sortBy !== undefined && (
      typeof sortBy !== "string" || !allowedSortBy.includes(sortBy)
    )) {
      res.status(400).json({
        success: false,
        message: "sortBy must be name, size, createdAt, updatedAt, or mimeType",
      });
      return;
    }

    if (
      sortOrder !== undefined &&
      sortOrder !== "asc" &&
      sortOrder !== "desc"
    ) {
      res.status(400).json({
        success: false,
        message: "sortOrder must be asc or desc",
      });
      return;
    }

    if (mimeType !== undefined && (
      typeof mimeType !== "string" ||
      mimeType.length > 255 ||
      !/^[\w.+-]+\/[\w.+*-]+$/.test(mimeType)
    )) {
      res.status(400).json({
        success: false,
        message: "mimeType must be a valid media type",
      });
      return;
    }

    if (folderId !== undefined && typeof folderId !== "string") {
      res.status(400).json({
        success: false,
        message: "folderId must be a string",
      });
      return;
    }

    const result = await searchFilesService({
      ownerId: req.userId,
      query: q,
      page,
      limit,
      folderId: folderId as string | undefined,
      mimeType: mimeType as string | undefined,
      sortBy: sortBy as "name" | "size" | "createdAt" | "updatedAt" | "mimeType" | undefined,
      sortOrder: sortOrder as "asc" | "desc" | undefined,
    });

    res.status(200).json({
      success: true,
      message: "Files searched successfully",
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};
