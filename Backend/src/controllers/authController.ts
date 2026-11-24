
import type { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { prisma } from "../config/database.js";
import type { NextFunction, Request, Response } from "express";

import {
  loginUser,
  registerUser,
  refreshUserTokens,
  logoutUser,
  updateUserProfile,
  changeUserPassword,
  resendEmailVerification,
  verifyEmailAddress,
} from "../services/authService.js";
import { requestAccountDeletion } from "../services/accountDeletionService.js";
import { enqueueAccountDeletionJob } from "../jobs/queues.js";

export const getMe = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      res.status(404).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Get profile error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to retrieve user profile",
    });
  }
};

export const resendVerification = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email } = req.body ?? {};
    if (typeof email !== "string" || !email.trim()) {
      res.status(400).json({
        success: false,
        message: "A valid email address is required",
      });
      return;
    }

    await resendEmailVerification(email);
    res.status(202).json({
      success: true,
      message: "If an eligible account exists, a verification message will be sent.",
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("email delivery")
    ) {
      console.error("[Auth] Verification message delivery failed");
      res.status(202).json({
        success: true,
        message: "If an eligible account exists, a verification message will be sent.",
      });
      return;
    }
    next(error);
  }
};

export const verifyEmail = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { token, password } = req.body ?? {};
    if (
      typeof token !== "string" ||
      !token.trim() ||
      typeof password !== "string"
    ) {
      res.status(400).json({
        success: false,
        message: "A verification token and password are required",
      });
      return;
    }

    await verifyEmailAddress(token, password);
    res.status(200).json({
      success: true,
      message: "Email address verified successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const updateMe = async (
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

    const { name } = req.body ?? {};

    if (typeof name !== "string") {
      res.status(400).json({
        success: false,
        message: "A valid name is required",
      });
      return;
    }

    const user = await updateUserProfile(req.userId, name);

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (
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

    const { currentPassword, newPassword } = req.body ?? {};

    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string" ||
      !currentPassword ||
      !newPassword
    ) {
      res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
      return;
    }

    await changeUserPassword({
      userId: req.userId,
      currentPassword,
      newPassword,
    });

    res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const deleteMe = async (
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

    const { currentPassword } = req.body ?? {};

    if (typeof currentPassword !== "string" || !currentPassword) {
      res.status(400).json({
        success: false,
        message: "Current password is required",
      });
      return;
    }

    await requestAccountDeletion({
      userId: req.userId,
      currentPassword,
    });

    // The pending marker is durable. If Redis is unavailable, the queue
    // helper uses the existing inline fallback and the worker can recover
    // pending accounts when it starts again.
    await enqueueAccountDeletionJob(req.userId);

    res.status(202).json({
      success: true,
      message: "Account deletion has been scheduled",
    });
  } catch (error) {
    next(error);
  }
};

export const register = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password, name } = req.body ?? {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      (name !== undefined && typeof name !== "string")
    ) {
      res.status(400).json({
        success: false,
        message:
          "Valid email, password, and optional name are required",
      });
      return;
    }

    await registerUser(email, password, name);

    res.status(202).json({
      success: true,
      message:
        "If the address can be registered, a verification message will be sent.",
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password } = req.body ?? {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      res.status(400).json({
        success: false,
        message: "Valid email and password are required",
      });
      return;
    }

    const result = await loginUser(email, password);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const refresh = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { refreshToken } = req.body ?? {};

    if (
      typeof refreshToken !== "string" ||
      !refreshToken.trim()
    ) {
      res.status(400).json({
        success: false,
        message: "Refresh token is required",
      });
      return;
    }

    const tokens = await refreshUserTokens(refreshToken);

    res.status(200).json({
      success: true,
      data: tokens,
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { refreshToken } = req.body ?? {};

    if (
      typeof refreshToken !== "string" ||
      !refreshToken.trim()
    ) {
      res.status(400).json({
        success: false,
        message: "Refresh token is required",
      });
      return;
    }

    const result = await logoutUser(refreshToken);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
