import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../config/database.js";
import { AppError } from "../utils/AppError.js";
import { downloadObject } from "./storageService.js";
import { logActivity } from "./activityService.js";
import { withActiveAccountLock } from "./accountLifecycleService.js";

interface CreateShareLinkInput {
  fileId: string;
  ownerId: string;
  expiresAt?: Date | null;
  permission?: "VIEW" | "EDIT";
  sharedWithEmail?: string | null;
}

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

// Create a share link for an active file owned by the caller.
export const createShareLink = async ({
  fileId,
  ownerId,
  expiresAt,
  permission = "VIEW",
  sharedWithEmail,
}: CreateShareLinkInput) => {
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new AppError("Expiry must be in the future", 400);
  }

  if (permission !== "VIEW" && permission !== "EDIT") {
    throw new AppError("Permission must be either VIEW or EDIT", 400);
  }

  let recipientUserId: string | null = null;
  let normalizedEmail: string | null = null;

  const token = randomBytes(32).toString("base64url");

  const shareLink = await withActiveAccountLock(ownerId, async (tx) => {
    const file = await tx.file.findFirst({
      where: { id: fileId, ownerId, deletedAt: null },
      select: { id: true, name: true },
    });

    if (!file) throw new AppError("File not found", 404);

    if (sharedWithEmail) {
      normalizedEmail = sharedWithEmail.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(normalizedEmail)) {
        throw new AppError("A valid recipient email address is required", 400);
      }

      const caller = await tx.user.findUnique({
        where: { id: ownerId },
        select: { email: true },
      });

      if (caller && caller.email.toLowerCase() === normalizedEmail) {
        throw new AppError("You cannot share a file with yourself", 400);
      }

      const recipientUser = await tx.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, emailVerifiedAt: true, accountStatus: true },
      });

      if (
        !recipientUser?.emailVerifiedAt ||
        recipientUser.accountStatus !== "ACTIVE"
      ) {
        throw new AppError(
          "A verified recipient account is required for restricted sharing",
          400,
        );
      }

      recipientUserId = recipientUser.id;
    }

    return tx.shareLink.create({
      data: {
        tokenHash: hashToken(token),
        fileId: file.id,
        createdById: ownerId,
        permission,
        sharedWithEmail: normalizedEmail,
        sharedWithId: recipientUserId,
        expiresAt: expiresAt ?? null,
      },
      select: {
        id: true,
        fileId: true,
        permission: true,
        sharedWithEmail: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  });

  void logActivity({
    userId: ownerId,
    action: "FILE_SHARED",
    resourceType: "FILE",
    resourceId: fileId,
    resourceName: "File",
    details: {
      permission,
      sharedWithEmail: normalizedEmail,
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

// List all shares created by the caller across all active files.
export const listSharesCreatedByMe = async (ownerId: string) => {
  const shares = await prisma.shareLink.findMany({
    where: {
      createdById: ownerId,
      file: {
        deletedAt: null,
        owner: { accountStatus: "ACTIVE" },
      },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fileId: true,
      permission: true,
      sharedWithEmail: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
      file: {
        select: {
          id: true,
          name: true,
          originalName: true,
          mimeType: true,
          size: true,
        },
      },
      sharedWith: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  return shares.map((share) => ({
    ...share,
    file: {
      ...share.file,
      size: share.file.size.toString(),
    },
  }));
};

// List all files shared with the caller.
export const listSharesWithMe = async ({
  userId,
}: {
  userId: string;
}) => {
  const now = new Date();

  const shares = await prisma.shareLink.findMany({
    where: {
      revokedAt: null,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
      file: {
        deletedAt: null,
        owner: { accountStatus: "ACTIVE" },
      },
      sharedWithId: userId,
      sharedWith: {
        is: {
          emailVerifiedAt: { not: null },
          accountStatus: "ACTIVE",
        },
      },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fileId: true,
      permission: true,
      expiresAt: true,
      createdAt: true,
      file: {
        select: {
          id: true,
          name: true,
          originalName: true,
          mimeType: true,
          size: true,
          owner: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
    },
  });

  return shares.map((share) => ({
    id: share.id,
    fileId: share.fileId,
    permission: share.permission,
    expiresAt: share.expiresAt,
    createdAt: share.createdAt,
    file: {
      ...share.file,
      size: share.file.size.toString(),
    },
  }));
};

// Update sharing permissions or expiration for a share link.
export const updateSharePermission = async ({
  shareLinkId,
  ownerId,
  permission,
  expiresAt,
}: {
  shareLinkId: string;
  ownerId: string;
  permission?: "VIEW" | "EDIT";
  expiresAt?: Date | null;
}) => {
  const dataToUpdate: Record<string, unknown> = {};

  if (permission !== undefined) {
    if (permission !== "VIEW" && permission !== "EDIT") {
      throw new AppError("Permission must be either VIEW or EDIT", 400);
    }
    dataToUpdate.permission = permission;
  }

  if (expiresAt !== undefined) {
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new AppError("Expiry must be in the future", 400);
    }
    dataToUpdate.expiresAt = expiresAt;
  }

  const result = await withActiveAccountLock(ownerId, async (tx) => {
    const link = await tx.shareLink.findFirst({
      where: {
        id: shareLinkId,
        createdById: ownerId,
        file: { ownerId, deletedAt: null },
      },
      select: {
        id: true,
        file: { select: { name: true } },
      },
    });

    if (!link) throw new AppError("Share link not found", 404);

    const updated = await tx.shareLink.update({
      where: { id: link.id },
      data: dataToUpdate,
      select: {
        id: true,
        fileId: true,
        permission: true,
        expiresAt: true,
        revokedAt: true,
        updatedAt: true,
      },
    });

    return { updated, fileName: link.file?.name ?? "Shared link" };
  });

  const { updated, fileName } = result;

  void logActivity({
    userId: ownerId,
    action: "SHARE_PERMISSION_UPDATED",
    resourceType: "SHARE",
    resourceId: shareLinkId,
    resourceName: fileName,
    details: {
      newPermission: updated.permission,
      newExpiresAt: updated.expiresAt,
    },
  });

  return updated;
};

// Revoke a link only when its file belongs to the caller.
export const revokeShareLink = async ({
  shareLinkId,
  ownerId,
}: {
  shareLinkId: string;
  ownerId: string;
}) => {
  const revoked = await withActiveAccountLock(ownerId, async (tx) => {
    const link = await tx.shareLink.findFirst({
      where: {
        id: shareLinkId,
        createdById: ownerId,
        file: { ownerId },
      },
      select: { id: true, revokedAt: true },
    });

    if (!link) throw new AppError("Share link not found", 404);
    if (link.revokedAt) {
      throw new AppError("Share link is already revoked", 400);
    }

    return tx.shareLink.update({
      where: { id: link.id },
      data: { revokedAt: new Date() },
      select: { id: true, revokedAt: true },
    });
  });

  void logActivity({
    userId: ownerId,
    action: "SHARE_REVOKED",
    resourceType: "SHARE",
    resourceId: shareLinkId,
    resourceName: "Shared link",
  });

  return revoked;
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
      createdById: true,
      sharedWithId: true,
      sharedWithEmail: true,
      file: {
        select: {
          id: true,
          name: true,
          originalName: true,
          mimeType: true,
          size: true,
          storageKey: true,
          deletedAt: true,
          owner: { select: { accountStatus: true } },
        },
      },
    },
  });

  if (
    !link ||
    link.sharedWithId ||
    link.sharedWithEmail ||
    link.revokedAt ||
    (link.expiresAt && link.expiresAt.getTime() <= Date.now()) ||
    link.file.deletedAt ||
    link.file.owner.accountStatus !== "ACTIVE"
  ) {
    throw new AppError("Share link is invalid or unavailable", 404);
  }

  const object = await downloadObject(link.file.storageKey);

  void logActivity({
    userId: link.createdById,
    action: "FILE_DOWNLOADED",
    resourceType: "FILE",
    resourceId: link.file.id,
    resourceName: link.file.name,
    details: { via: "public_link" },
  });

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

// Download a file directly for a user it was shared with.
export const getSharedFileForUser = async ({
  shareId,
  userId,
}: {
  shareId: string;
  userId: string;
}) => {
  const now = new Date();

  const share = await prisma.shareLink.findFirst({
    where: {
      id: shareId,
      revokedAt: null,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
      file: {
        deletedAt: null,
        owner: { accountStatus: "ACTIVE" },
      },
      sharedWithId: userId,
      sharedWith: {
        is: {
          emailVerifiedAt: { not: null },
          accountStatus: "ACTIVE",
        },
      },
    },
    select: {
      id: true,
      permission: true,
      file: {
        select: {
          id: true,
          name: true,
          originalName: true,
          mimeType: true,
          size: true,
          storageKey: true,
        },
      },
    },
  });

  if (!share) {
    throw new AppError("Shared file not found or access has expired", 404);
  }

  const object = await downloadObject(share.file.storageKey);

  void logActivity({
    userId,
    action: "FILE_DOWNLOADED",
    resourceType: "FILE",
    resourceId: share.file.id,
    resourceName: share.file.name,
    details: { via: "shared_access" },
  });

  return {
    file: {
      id: share.file.id,
      originalName: share.file.originalName,
      mimeType: share.file.mimeType,
      size: share.file.size.toString(),
    },
    permission: share.permission,
    object,
  };
};
