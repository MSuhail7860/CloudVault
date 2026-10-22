import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import {
  uploadFile as uploadFileService,
  listFiles as listFilesService,
  getFileForDownload as getFileForDownloadService,
  renameFile as renameFileService,
  moveFileToTrash as moveFileToTrashService,
  listTrashedFiles as listTrashedFilesService,
  restoreFileFromTrash as restoreFileFromTrashService,
  permanentlyDeleteFile as permanentlyDeleteFileService,
} from "../services/fileService.js";

type UploadedFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
};

type FileUploadRequest = AuthenticatedRequest & {
  file?: UploadedFile;
};

// Upload a file.
export const uploadFile = async (
  req: FileUploadRequest,
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

    if (!req.file) {
      res.status(400).json({
        success: false,
        message: "A file is required. Use the multipart field 'file'.",
      });
      return;
    }

    const { folderId } = req.body ?? {};

    if (
      folderId !== undefined &&
      folderId !== "" &&
      typeof folderId !== "string"
    ) {
      res.status(400).json({
        success: false,
        message: "folderId must be a string",
      });
      return;
    }

    const file = await uploadFileService({
      ownerId: req.userId,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
      folderId: folderId || null,
    });

    res.status(201).json({
      success: true,
      message: "File uploaded successfully",
      data: {
        ...file,
        size: file.size.toString(),
      },
    });
  } catch (error) {
    next(error);
  }
};

// List active files belonging to the authenticated user.
export const listFiles = async (
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

    const { folderId } = req.query;

    if (folderId !== undefined && typeof folderId !== "string") {
      res.status(400).json({
        success: false,
        message: "folderId must be a string",
      });
      return;
    }

    const files = await listFilesService({
      ownerId: req.userId,
      folderId: folderId || null,
    });

    res.status(200).json({
      success: true,
      message: "Files retrieved successfully",
      data: files,
    });
  } catch (error) {
    next(error);
  }
};

// Download an active file owned by the authenticated user.
export const downloadFile = async (
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

    const fileId = req.params.id;

    if (typeof fileId !== "string" || !fileId.trim()) {
      res.status(400).json({
        success: false,
        message: "A valid file ID is required",
      });
      return;
    }

    const { file, object } = await getFileForDownloadService({
      fileId,
      ownerId: req.userId,
    });

    if (!object.Body) {
      throw new Error("File content is unavailable in storage.");
    }

    const bytes = await object.Body.transformToByteArray();

    res.status(200);
    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    res.setHeader("Content-Length", bytes.byteLength);
    res.attachment(file.originalName);
    res.send(Buffer.from(bytes));
  } catch (error) {
    next(error);
  }
};

// Rename an active file.
export const renameFile = async (
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

    const fileId = req.params.id;
    const { name } = req.body ?? {};

    if (typeof fileId !== "string" || !fileId.trim()) {
      res.status(400).json({
        success: false,
        message: "A valid file ID is required",
      });
      return;
    }

    if (typeof name !== "string") {
      res.status(400).json({
        success: false,
        message: "A new file name is required",
      });
      return;
    }

    const file = await renameFileService({
      fileId,
      ownerId: req.userId,
      newName: name,
    });

    res.status(200).json({
      success: true,
      message: "File renamed successfully",
      data: {
        ...file,
        size: file.size.toString(),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Move an active file to Trash.
export const moveFileToTrash = async (
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

    const fileId = req.params.id;

    if (typeof fileId !== "string" || !fileId.trim()) {
      res.status(400).json({
        success: false,
        message: "A valid file ID is required",
      });
      return;
    }

    const file = await moveFileToTrashService({
      fileId,
      ownerId: req.userId,
    });

    res.status(200).json({
      success: true,
      message: "File moved to Trash successfully",
      data: file,
    });
  } catch (error) {
    next(error);
  }
};

// List files in Trash.
export const listTrashedFiles = async (
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

    const files = await listTrashedFilesService({
      ownerId: req.userId,
    });

    res.status(200).json({
      success: true,
      message: "Trash retrieved successfully",
      data: files,
    });
  } catch (error) {
    next(error);
  }
};

// Restore a file from Trash.
export const restoreFileFromTrash = async (
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

    const fileId = req.params.id;

    if (typeof fileId !== "string" || !fileId.trim()) {
      res.status(400).json({
        success: false,
        message: "A valid file ID is required",
      });
      return;
    }

    const file = await restoreFileFromTrashService({
      fileId,
      ownerId: req.userId,
    });

    res.status(200).json({
      success: true,
      message: "File restored successfully",
      data: {
        ...file,
        size: file.size.toString(),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Permanently delete a file that is already in Trash.
export const permanentlyDeleteFile = async (
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

    const fileId = req.params.id;

    if (typeof fileId !== "string" || !fileId.trim()) {
      res.status(400).json({
        success: false,
        message: "A valid file ID is required",
      });
      return;
    }

    await permanentlyDeleteFileService({
      fileId,
      ownerId: req.userId,
    });

    res.status(200).json({
      success: true,
      message: "File permanently deleted",
    });
  } catch (error) {
    next(error);
  }
};