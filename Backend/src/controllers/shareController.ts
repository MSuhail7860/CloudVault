import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import {
  createShareLink as createShareLinkService,
  listShareLinks as listShareLinksService,
  listSharesCreatedByMe as listSharesCreatedByMeService,
  listSharesWithMe as listSharesWithMeService,
  updateSharePermission as updateSharePermissionService,
  revokeShareLink as revokeShareLinkService,
  getSharedFile as getSharedFileService,
  getSharedFileForUser as getSharedFileForUserService,
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

    const { permission, sharedWithEmail } = req.body ?? {};

    if (permission !== undefined && permission !== "VIEW" && permission !== "EDIT") {
      res.status(400).json({ success: false, message: "Permission must be either VIEW or EDIT" });
      return;
    }

    if (sharedWithEmail !== undefined && sharedWithEmail !== null && typeof sharedWithEmail !== "string") {
      res.status(400).json({ success: false, message: "sharedWithEmail must be a string" });
      return;
    }

    const shareLink = await createShareLinkService({
      fileId,
      ownerId: req.userId,
      expiresAt,
      permission: permission || "VIEW",
      sharedWithEmail: sharedWithEmail || null,
    });

    res.status(201).json({
      success: true,
      message: "Share link created successfully",
      data: {
        id: shareLink.id,
        fileId: shareLink.fileId,
        token: shareLink.token,
        permission: shareLink.permission,
        sharedWithEmail: shareLink.sharedWithEmail,
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

export const listSharesCreatedByMe = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, message: "Authentication is required" });
      return;
    }

    const shares = await listSharesCreatedByMeService(req.userId);

    res.status(200).json({
      success: true,
      message: "Shared links retrieved successfully",
      data: shares,
    });
  } catch (error) {
    next(error);
  }
};

export const listSharesWithMe = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, message: "Authentication is required" });
      return;
    }

    const shares = await listSharesWithMeService({
      userId: req.userId,
    });

    res.status(200).json({
      success: true,
      message: "Files shared with you retrieved successfully",
      data: shares,
    });
  } catch (error) {
    next(error);
  }
};

export const updateSharePermission = async (
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

    const { permission, expiresAt } = req.body ?? {};

    let parsedExpiresAt: Date | null | undefined = undefined;
    if (expiresAt !== undefined) {
      if (expiresAt === null) {
        parsedExpiresAt = null;
      } else if (typeof expiresAt === "string") {
        parsedExpiresAt = new Date(expiresAt);
        if (Number.isNaN(parsedExpiresAt.getTime())) {
          res.status(400).json({ success: false, message: "expiresAt must be a valid date" });
          return;
        }
      } else {
        res.status(400).json({ success: false, message: "expiresAt must be an ISO date string or null" });
        return;
      }
    }

    const updated = await updateSharePermissionService({
      shareLinkId,
      ownerId: req.userId,
      permission,
      expiresAt: parsedExpiresAt,
    });

    res.status(200).json({
      success: true,
      message: "Share permission updated successfully",
      data: updated,
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
    res.attachment(file.originalName);
    res.send(Buffer.from(bytes));
  } catch (error) {
    next(error);
  }
};

export const downloadSharedFileForUser = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, message: "Authentication is required" });
      return;
    }

    const shareId = req.params.shareId;
    if (typeof shareId !== "string" || !shareId.trim()) {
      res.status(400).json({ success: false, message: "A valid share ID is required" });
      return;
    }

    const { file, object } = await getSharedFileForUserService({
      shareId,
      userId: req.userId,
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
