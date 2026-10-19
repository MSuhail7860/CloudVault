
import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import {
  createShareLink as createShareLinkService,
  listShareLinks as listShareLinksService,
  revokeShareLink as revokeShareLinkService,
  getSharedFile as getSharedFileService,
} from "../services/shareService.js";

export const createShareLink = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, message: "Authentication is required" });
      return;
    }

    const fileId = req.params.id;
    if (typeof fileId !== "string" || !fileId.trim()) {
      res.status(400).json({ success: false, message: "A valid file ID is required" });
      return;
    }

    let expiresAt: Date | null = null;
    if (req.body?.expiresAt !== undefined && req.body.expiresAt !== null) {
      if (typeof req.body.expiresAt !== "string") {
        res.status(400).json({ success: false, message: "expiresAt must be an ISO date string" });
        return;
      }

      expiresAt = new Date(req.body.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        res.status(400).json({ success: false, message: "expiresAt must be a valid date" });
        return;
      }
    }

    const shareLink = await createShareLinkService({
      fileId,
      ownerId: req.userId,
      expiresAt,
    });

    res.status(201).json({
      success: true,
      message: "Share link created successfully",
      data: {
        id: shareLink.id,
        fileId: shareLink.fileId,
        token: shareLink.token,
        expiresAt: shareLink.expiresAt,
        createdAt: shareLink.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const listShareLinks = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, message: "Authentication is required" });
      return;
    }

    const fileId = req.params.id;
    if (typeof fileId !== "string" || !fileId.trim()) {
      res.status(400).json({ success: false, message: "A valid file ID is required" });
      return;
    }

    const links = await listShareLinksService({
      fileId,
      ownerId: req.userId,
    });

    res.status(200).json({
      success: true,
      message: "Share links retrieved successfully",
      data: links,
    });
  } catch (error) {
    next(error);
  }
};

export const revokeShareLink = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, message: "Authentication is required" });
      return;
    }

    const shareLinkId = req.params.id;
    if (typeof shareLinkId !== "string" || !shareLinkId.trim()) {
      res.status(400).json({ success: false, message: "A valid share link ID is required" });
      return;
    }

    const link = await revokeShareLinkService({
      shareLinkId,
      ownerId: req.userId,
    });

    res.status(200).json({
      success: true,
      message: "Share link revoked successfully",
      data: link,
    });
  } catch (error) {
    next(error);
  }
};

export const downloadSharedFile = async (
  req: import("express").Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const token = req.params.token;
    if (typeof token !== "string" || !token) {
      res.status(404).json({
        success: false,
        message: "Share link is invalid or unavailable",
      });
      return;
    }

    const { file, object } = await getSharedFileService(token);
    if (!object.Body) {
      throw new Error("File content is unavailable in storage.");
    }

    const bytes = await object.Body.transformToByteArray();

    res.status(200);
    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    res.setHeader("Content-Length", bytes.byteLength);
    res.setHeader("Cache-Control", "no-store");
    res.attachment(file.originalName);
    res.send(Buffer.from(bytes));
  } catch (error) {
    next(error);
  }
};
