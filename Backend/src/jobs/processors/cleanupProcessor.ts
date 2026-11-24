import { prisma } from "../../config/database.js";

export const processCleanupJob = async (): Promise<{ expiredLinksRevoked: number }> => {
  const now = new Date();

  // Find all unrevoked share links that have passed their expiration date
  const expiredLinks = await prisma.shareLink.updateMany({
    where: {
      revokedAt: null,
      expiresAt: { lte: now },
    },
    data: {
      revokedAt: now,
    },
  });

  if (expiredLinks.count > 0) {
    console.log(`[CleanupProcessor] Revoked ${expiredLinks.count} expired share links.`);
  }

  return { expiredLinksRevoked: expiredLinks.count };
};

