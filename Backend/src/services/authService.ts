import bcrypt from "bcrypt";
import { prisma } from "../config/database.js";
import { hashToken } from "../utils/tokenHash.js";
import { AppError } from "../utils/AppError.js";

import {
  createAccessToken,
  createRefreshToken,
  verifyRefreshToken,
} from "../utils/jwt.js";

export const registerUser = async (
  email: string,
  password: string,
  name?: string
) => {
  const normalizedEmail = email.trim().toLowerCase();

  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingUser) {
    throw new AppError(
      "User with this email already exists",
      409
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      name: name?.trim() || undefined,
    },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return user;
};

export const loginUser = async (
  email: string,
  password: string
) => {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    throw new AppError("Invalid email or password", 401);
  }

  const passwordMatches = await bcrypt.compare(
    password,
    user.passwordHash
  );

  if (!passwordMatches) {
    throw new AppError("Invalid email or password", 401);
  }

  const [accessToken, refreshToken] = await Promise.all([
    createAccessToken(user.id),
    createRefreshToken(user.id),
  ]);

  const tokenHash = hashToken(refreshToken);

  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000
  );

  await prisma.refreshToken.create({
    data: {
      tokenHash,
      userId: user.id,
      expiresAt,
    },
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    accessToken,
    refreshToken,
  };
};

export const refreshUserTokens = async (
  refreshToken: string
) => {
  let userId: string;

  try {
    ({ userId } = await verifyRefreshToken(refreshToken));
  } catch {
    throw new AppError(
      "Invalid or expired refresh token",
      401
    );
  }

  const tokenHash = hashToken(refreshToken);

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
  });

  if (
    !storedToken ||
    storedToken.userId !== userId ||
    storedToken.revokedAt !== null ||
    storedToken.expiresAt <= new Date()
  ) {
    throw new AppError(
      "Invalid or expired refresh token",
      401
    );
  }

  const [accessToken, newRefreshToken] = await Promise.all([
    createAccessToken(userId),
    createRefreshToken(userId),
  ]);

  const newTokenHash = hashToken(newRefreshToken);

  const newExpiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000
  );

  await prisma.$transaction(async (tx) => {
    const result = await tx.refreshToken.updateMany({
      where: {
        id: storedToken.id,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        revokedAt: new Date(),
      },
    });

    if (result.count !== 1) {
      throw new AppError(
        "Invalid or expired refresh token",
        401
      );
    }

    await tx.refreshToken.create({
      data: {
        tokenHash: newTokenHash,
        userId,
        expiresAt: newExpiresAt,
      },
    });
  });

  return {
    accessToken,
    refreshToken: newRefreshToken,
  };
};

export const logoutUser = async (
  refreshToken: string
) => {
  let userId: string;

  try {
    ({ userId } = await verifyRefreshToken(refreshToken));
  } catch {
    throw new AppError(
      "Invalid or expired refresh token",
      401
    );
  }

  const tokenHash = hashToken(refreshToken);

  const result = await prisma.refreshToken.updateMany({
    where: {
      tokenHash,
      userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: {
      revokedAt: new Date(),
    },
  });

  if (result.count !== 1) {
    throw new AppError(
      "Invalid or expired refresh token",
      401
    );
  }

  return {
    message: "Logged out successfully",
  };
};