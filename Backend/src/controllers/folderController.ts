import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import {
  createFolder as createFolderService,
  listFolders as listFoldersService,
  deleteFolder as deleteFolderService,
  renameFolder as renameFolderService,
  moveFolder as moveFolderService,
} from "../services/folderService.js";

const parsePositiveInteger = (value: unknown): number | undefined | null => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

// POST /api/v1/folders
export const createFolder = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name, parentId } = req.body ?? {};

    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({
        success: false,
        message: "A valid folder name is required",
      });
      return;
    }

    if (
      parentId !== undefined &&
      parentId !== null &&
      (typeof parentId !== "string" || !parentId.trim())
    ) {
      res.status(400).json({
        success: false,
        message: "parentId must be a non-empty string or null",
      });
      return;
    }

    if (!req.userId) {
      res.status(401).json({
        success: false,
        message: "Authentication is required",
      });
      return;
    }

    const folder = await createFolderService({
      name,
      ownerId: req.userId,
      parentId,
    });

    res.status(201).json({
      success: true,
      data: folder,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/folders
export const listFolders = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({
        success: false,
        message: "Authentication is required",
      });
      return;
    }

    const { parentId, sortBy, sortOrder, page: rawPage, limit: rawLimit } = req.query;

    if (parentId !== undefined && typeof parentId !== "string") {
      res.status(400).json({
        success: false,
        message: "parentId must be a string",
      });
      return;
    }

    const page = parsePositiveInteger(rawPage);
    const limit = parsePositiveInteger(rawLimit);
    if (page === null || limit === null || (limit !== undefined && limit > 100)) {
      res.status(400).json({
        success: false,
        message: "page and limit must be positive integers; limit cannot exceed 100",
      });
      return;
    }

    const allowedSortBy = ["name", "createdAt", "updatedAt"];
    if (sortBy !== undefined && (
      typeof sortBy !== "string" || !allowedSortBy.includes(sortBy)
    )) {
      res.status(400).json({
        success: false,
        message: "sortBy must be name, createdAt, or updatedAt",
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

    const result = await listFoldersService(
      req.userId,
      typeof parentId === "string" && parentId.trim() ? parentId : null,
      {
        page,
        limit,
        sortBy: sortBy as "name" | "createdAt" | "updatedAt" | undefined,
        sortOrder: sortOrder as "asc" | "desc" | undefined,
      },
    );

    res.status(200).json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/folders/:folderId
export const deleteFolder = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const folderId = req.params.folderId;

    // Validate the folder ID and narrow its type to string.
    if (typeof folderId !== "string" || !folderId.trim()) {
      res.status(400).json({
        success: false,
        message: "A valid folder ID is required",
      });
      return;
    }

    if (!req.userId) {
      res.status(401).json({
        success: false,
        message: "Authentication is required",
      });
      return;
    }

    await deleteFolderService({
      folderId,
      ownerId: req.userId,
    });

    res.status(200).json({
      success: true,
      message: "Folder deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/v1/folders/:folderId/rename
export const renameFolder = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const folderId = req.params.folderId;
    const { name } = req.body ?? {};

    if (typeof folderId !== "string" || !folderId.trim()) {
      res.status(400).json({
        success: false,
        message: "A valid folder ID is required",
      });
      return;
    }

    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({
        success: false,
        message: "A valid folder name is required",
      });
      return;
    }

    if (!req.userId) {
      res.status(401).json({
        success: false,
        message: "Authentication is required",
      });
      return;
    }

    const folder = await renameFolderService({
      folderId,
      ownerId: req.userId,
      name,
    });

    res.status(200).json({
      success: true,
      data: folder,
    });
  } catch (error) {
    next(error);
  }
};

export const moveFolder = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const folderId = req.params.folderId;
    const { parentId } = req.body ?? {};

    if (typeof folderId !== "string" || !folderId.trim()) {
      res.status(400).json({
        success: false,
        message: "A valid folder ID is required",
      });
      return;
    }

    if (
      parentId !== null &&
      (typeof parentId !== "string" || !parentId.trim())
    ) {
      res.status(400).json({
        success: false,
        message: "parentId must be a valid folder ID or null",
      });
      return;
    }

    if (!req.userId) {
      res.status(401).json({
        success: false,
        message: "Authentication is required",
      });
      return;
    }

    const folder = await moveFolderService({
      folderId,
      ownerId: req.userId,
      parentId,
    });

    res.status(200).json({
      success: true,
      message: "Folder moved successfully",
      data: folder,
    });
  } catch (error) {
    next(error);
  }
};