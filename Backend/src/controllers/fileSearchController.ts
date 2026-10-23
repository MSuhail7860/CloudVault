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

    const page = parsePositiveInteger(req.query.page);
    const limit = parsePositiveInteger(req.query.limit);

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

    const result = await searchFilesService({
      ownerId: req.userId,
      query: q,
      page,
      limit,
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
