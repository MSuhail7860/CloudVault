import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import {
  uploadFile as uploadFileService,
  listFiles as listFilesService,
  getFileForDownload as getFileForDownloadService,
} from "../services/fileService.js";

type UploadedFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
};

type FileUploadRequest = AuthenticatedRequest & {
  file?: UploadedFile;
};

// Upload a file
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

// List files belonging to the authenticated user
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

// Download a file owned by the authenticated user
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
    res.setHeader("Content-Disposition", "attachment");

    // Express safely formats the filename for the response header.
    res.attachment(file.originalName);
    res.send(Buffer.from(bytes));
  } catch (error) {
    next(error);
  }
};