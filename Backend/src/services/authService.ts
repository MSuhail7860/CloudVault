import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { prisma } from "../config/database.js";
import { hashToken } from "../utils/tokenHash.js";
import { AppError } from "../utils/AppError.js";
import { withActiveAccountLock } from "./accountLifecycleService.js";
import { sendVerificationEmail } from "./emailService.js";

import {
  createAccessToken,
  createRefreshToken,
  verifyRefreshToken,
} from "../utils/jwt.js";

const safeUserSelect = {
  id: true,
  email: true,
  emailVerifiedAt: true,
  name: true,
  createdAt: true,
  updatedAt: true,
} as const;

const PASSWORD_SALT_ROUNDS = 12;
const MAX_PROFILE_NAME_LENGTH = 100;
const MAX_PASSWORD_BYTES = 72;

export const registerUser = async (
  email: string,
  password: string,
  name?: string
) => {
  const normalizedEmail = email.trim().toLowerCase();
  if (password.length < 8) {
    throw new AppError("Password must contain at least 8 characters", 400);
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    throw new AppError(
      `Password cannot exceed ${MAX_PASSWORD_BYTES} bytes`,
      400,
    );
  }
  const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);

  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });

  if (existingUser) {
    await issueEmailVerification(existingUser.id, true);
    return null;
  }

  let user;
  try {
    user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        name: name?.trim() || undefined,
      },
      select: {
        ...safeUserSelect,
      },
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      const racedUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });
      if (racedUser) {
        await issueEmailVerification(racedUser.id, true);
        return null;
      }
    }
    throw error;
  }

  await issueEmailVerification(user.id);
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

  if (user.accountStatus === "PENDING_DELETION") {
    throw new AppError("Invalid email or password", 401);
  }

  const passwordMatches = await bcrypt.compare(
    password,
    user.passwordHash
  );

  if (!passwordMatches) {
    throw new AppError("Invalid email or password", 401);
  }

  if (!user.emailVerifiedAt) {
    throw new AppError("Invalid email or password", 401);
  }

  const [accessToken, refreshToken] = await Promise.all([
    createAccessToken(user.id, user.sessionVersion),
    createRefreshToken(user.id, user.sessionVersion),
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
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    accessToken,
    refreshToken,
  };
};

export const updateUserProfile = async (
  userId: string,
  name: string,
) => {
  const normalizedName = name.trim();

  if (!normalizedName) {
    throw new AppError("Name cannot be empty", 400);
  }

  if (normalizedName.length > MAX_PROFILE_NAME_LENGTH) {
    throw new AppError(
      `Name cannot exceed ${MAX_PROFILE_NAME_LENGTH} characters`,
      400,
    );
  }

  return withActiveAccountLock(userId, (tx) =>
    tx.user.update({
      where: { id: userId },
      data: { name: normalizedName },
      select: safeUserSelect,
    }),
  );
};

export const changeUserPassword = async ({
  userId,
  currentPassword,
  newPassword,
}: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<void> => {
  if (newPassword.length < 8) {
    throw new AppError(
      "New password must contain at least 8 characters",
      400,
    );
  }

  if (Buffer.byteLength(newPassword, "utf8") > MAX_PASSWORD_BYTES) {
    throw new AppError(
      `New password cannot exceed ${MAX_PASSWORD_BYTES} bytes`,
      400,
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      passwordHash: true,
    },
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  const currentPasswordMatches = await bcrypt.compare(
    currentPassword,
    user.passwordHash,
  );

  if (!currentPasswordMatches) {
    throw new AppError("Current password is incorrect", 401);
  }

  if (currentPassword === newPassword) {
    throw new AppError(
      "New password must be different from the current password",
      400,
    );
  }

  const newPasswordHash = await bcrypt.hash(
    newPassword,
    PASSWORD_SALT_ROUNDS,
  );

  await withActiveAccountLock(userId, async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash: newPasswordHash,
        sessionVersion: { increment: 1 },
      },
    });

    await tx.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  });
};

export const refreshUserTokens = async (
  refreshToken: string
) => {
  let userId: string;
  let sessionVersion: number;

  try {
    ({ userId, sessionVersion } = await verifyRefreshToken(refreshToken));
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

  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      accountStatus: true,
      sessionVersion: true,
      emailVerifiedAt: true,
    },
  });

  if (
    !account ||
    account.accountStatus !== "ACTIVE" ||
    !account.emailVerifiedAt ||
    account.sessionVersion !== sessionVersion
  ) {
    throw new AppError("Invalid or expired refresh token", 401);
  }

  const [accessToken, newRefreshToken] = await Promise.all([
    createAccessToken(userId, sessionVersion),
    createRefreshToken(userId, sessionVersion),
  ]);

  const newTokenHash = hashToken(newRefreshToken);

  const newExpiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000
  );

  await withActiveAccountLock(userId, async (tx) => {
    const currentAccount = await tx.user.findUnique({
      where: { id: userId },
      select: {
        accountStatus: true,
        sessionVersion: true,
        emailVerifiedAt: true,
      },
    });

    if (
      !currentAccount ||
      currentAccount.accountStatus !== "ACTIVE" ||
      !currentAccount.emailVerifiedAt ||
      currentAccount.sessionVersion !== sessionVersion
    ) {
      throw new AppError("Invalid or expired refresh token", 401);
    }

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
  let sessionVersion: number;

  try {
    ({ userId, sessionVersion } = await verifyRefreshToken(refreshToken));
  } catch {
    throw new AppError(
      "Invalid or expired refresh token",
      401
    );
  }

  const tokenHash = hashToken(refreshToken);

  await withActiveAccountLock(userId, async (tx) => {
    const account = await tx.user.findUnique({
      where: { id: userId },
      select: {
        sessionVersion: true,
        emailVerifiedAt: true,
      },
    });
    if (
      !account ||
      !account.emailVerifiedAt ||
      account.sessionVersion !== sessionVersion
    ) {
      throw new AppError("Invalid or expired refresh token", 401);
    }

    const result = await tx.refreshToken.updateMany({
      where: {
        tokenHash,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date() },
    });
    if (result.count !== 1) {
      throw new AppError("Invalid or expired refresh token", 401);
    }

    await tx.user.update({
      where: { id: userId },
      data: { sessionVersion: { increment: 1 } },
    });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });

  return {
    message: "Logged out successfully",
  };
};

const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;

const issueEmailVerification = async (
  userId: string,
  enforceCooldown = false,
): Promise<void> => {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const now = new Date();

  const message = await withActiveAccountLock(userId, async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    });
    if (!user || user.emailVerifiedAt) return null;

    const previous = await tx.emailVerificationToken.findUnique({
      where: { userId },
      select: { createdAt: true },
    });
    if (
      enforceCooldown &&
      previous &&
      now.getTime() - previous.createdAt.getTime() <
        EMAIL_VERIFICATION_RESEND_COOLDOWN_MS
    ) {
      return null;
    }

    await tx.emailVerificationToken.upsert({
      where: { userId },
      create: {
        userId,
        tokenHash,
        expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
      },
      update: {
        tokenHash,
        expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
        consumedAt: null,
        createdAt: now,
      },
    });

    return { email: user.email, token };
  });

  if (message) {
    try {
      await sendVerificationEmail(message.email, message.token);
    } catch (error) {
      const errorName =
        error instanceof Error ? error.name : "UnknownError";
      console.error(
        JSON.stringify({
          event: "verification_email_delivery_failed",
          errorName,
        }),
      );
    }
  }
};

export const resendEmailVerification = async (email: string): Promise<void> => {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      accountStatus: true,
      emailVerifiedAt: true,
    },
  });

  if (!user || user.accountStatus !== "ACTIVE" || user.emailVerifiedAt) return;
  await issueEmailVerification(user.id, true);
};

export const verifyEmailAddress = async (
  token: string,
  newPassword: string,
): Promise<void> => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new AppError("Verification link is invalid or expired", 400);
  }
  if (newPassword.length < 8) {
    throw new AppError(
      "Password must contain at least 8 characters",
      400,
    );
  }
  if (Buffer.byteLength(newPassword, "utf8") > MAX_PASSWORD_BYTES) {
    throw new AppError(
      `Password cannot exceed ${MAX_PASSWORD_BYTES} bytes`,
      400,
    );
  }

  const tokenHash = hashToken(token);
  const now = new Date();
  const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    const consumed = await tx.emailVerificationToken.updateMany({
      where: {
        tokenHash,
        consumedAt: null,
        expiresAt: { gt: now },
        user: { accountStatus: "ACTIVE", emailVerifiedAt: null },
      },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      throw new AppError("Verification link is invalid or expired", 400);
    }

    const tokenRecord = await tx.emailVerificationToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    if (!tokenRecord) {
      throw new AppError("Verification link is invalid or expired", 400);
    }

    const verified = await tx.user.updateMany({
      where: {
        id: tokenRecord.userId,
        accountStatus: "ACTIVE",
        emailVerifiedAt: null,
      },
      data: {
        emailVerifiedAt: now,
        passwordHash,
        sessionVersion: { increment: 1 },
      },
    });
    if (verified.count !== 1) {
      throw new AppError("Verification link is invalid or expired", 400);
    }

    await tx.refreshToken.updateMany({
      where: { userId: tokenRecord.userId, revokedAt: null },
      data: { revokedAt: now },
    });
  });
};
