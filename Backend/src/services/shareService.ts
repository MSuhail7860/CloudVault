
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../config/database.js";
import { AppError } from "../utils/AppError.js";
import { downloadObject } from "./storageService.js";

interface CreateShareLinkInput {
  fileId: string;
  ownerId: string;
  expiresAt?: Date | null;
}

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

// Create a share link for an active file owned by the caller.
export const createShareLink = async ({
  fileId,
  ownerId,
  expiresAt,
}: CreateShareLinkInput) => {
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new AppError("Expiry must be in the future", 400);
  }

  const file = await prisma.file.findFirst({
    where: {
      id: fileId,
      ownerId,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!file) {
    throw new AppError("File not found", 404);
  }

  const token = randomBytes(32).toString("base64url");

  const shareLink = await prisma.shareLink.create({
    data: {
      tokenHash: hashToken(token),
      fileId: file.id,
      createdById: ownerId,
      expiresAt: expiresAt ?? null,
    },
    select: {
      id: true,
      fileId: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  // Return the raw token once; only its hash is persisted.
  return { ...shareLink, token };
};

// List links for a file only if the caller owns the active file.
export const listShareLinks = async ({
  fileId,
  ownerId,
}: {
  fileId: string;
  ownerId: string;
}) => {
  const file = await prisma.file.findFirst({
    where: { id: fileId, ownerId, deletedAt: null },
    select: { id: true },
  });

  if (!file) {
    throw new AppError("File not found", 404);
  }

  return prisma.shareLink.findMany({
    where: { fileId: file.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fileId: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
};

// Revoke a link only when its file belongs to the caller.
export const revokeShareLink = async ({
  shareLinkId,
  ownerId,
}: {
  shareLinkId: string;
  ownerId: string;
}) => {
  const link = await prisma.shareLink.findFirst({
    where: {
      id: shareLinkId,
      createdById: ownerId,
      file: { ownerId },
    },
    select: { id: true, revokedAt: true },
  });

  if (!link) {
    throw new AppError("Share link not found", 404);
  }

  if (link.revokedAt) {
    throw new AppError("Share link is already revoked", 400);
  }

  return prisma.shareLink.update({
    where: { id: link.id },
    data: { revokedAt: new Date() },
    select: { id: true, revokedAt: true },
  });
};

// Validate a public token before retrieving the file from storage.
export const getSharedFile = async (token: string) => {
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) {
    throw new AppError("Share link is invalid or unavailable", 404);
  }

  const link = await prisma.shareLink.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      revokedAt: true,
      expiresAt: true,
      file: {
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          size: true,
          storageKey: true,
          deletedAt: true,
        },
      },
    },
  });

  if (
    !link ||
    link.revokedAt ||
    (link.expiresAt && link.expiresAt.getTime() <= Date.now()) ||
    link.file.deletedAt
  ) {
    throw new AppError("Share link is invalid or unavailable", 404);
  }

  const object = await downloadObject(link.file.storageKey);

  return {
    file: {
      id: link.file.id,
      originalName: link.file.originalName,
      mimeType: link.file.mimeType,
      size: link.file.size.toString(),
    },
    object,
  };
};
