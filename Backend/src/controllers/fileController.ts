import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { uploadFile as uploadFileService } from "../services/fileService.js";

type UploadedFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
};

type FileUploadRequest = AuthenticatedRequest & {
  file?: UploadedFile;
};

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
