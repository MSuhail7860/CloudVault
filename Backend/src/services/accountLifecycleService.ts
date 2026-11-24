import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../config/database.js";
import { AppError } from "../utils/AppError.js";

/**
 * The User row is the lifecycle lock for all user-owned mutations.
 * A no-op UPDATE takes a PostgreSQL row lock without holding a transaction
 * while S3 is accessed. Deletion changes the same row to PENDING_DELETION in
 * its transition transaction, so earlier mutations commit first and later
 * mutations are rejected.
 */
export const withActiveAccountLock = async <T>(
  userId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> => prisma.$transaction(async (tx) => {
  const lockedRows = await tx.$executeRaw`
    UPDATE "User"
    SET "id" = "id"
    WHERE "id" = ${userId}
      AND "accountStatus" = 'ACTIVE'
  `;

  if (lockedRows !== 1) {
    throw new AppError("Account is unavailable", 401);
  }

  return operation(tx);
});

export const withPendingAccountLock = async <T>(
  userId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T | null> => prisma.$transaction(async (tx) => {
  const lockedRows = await tx.$executeRaw`
    UPDATE "User"
    SET "id" = "id"
    WHERE "id" = ${userId}
      AND "accountStatus" = 'PENDING_DELETION'
  `;

  if (lockedRows !== 1) {
    return null;
  }

  return operation(tx);
});
