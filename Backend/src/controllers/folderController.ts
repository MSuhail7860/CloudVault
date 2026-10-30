import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import {
  createFolder as createFolderService,
  listFolders as listFoldersService,
  deleteFolder as deleteFolderService,
} from "../services/folderService.js";

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

    const parentId =
      typeof req.query.parentId === "string" && req.query.parentId.trim()
        ? req.query.parentId
        : null;

    const folders = await listFoldersService(req.userId, parentId);

    res.status(200).json({
      success: true,
      data: folders,
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