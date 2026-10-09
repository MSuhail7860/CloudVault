
import type { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { prisma } from "../config/database.js";
import type { NextFunction, Request, Response } from "express";

import {
  loginUser,
  registerUser,
  refreshUserTokens,
  logoutUser,
} from "../services/authService.js";

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

    const user = await registerUser(email, password, name);

    res.status(201).json({
      success: true,
      data: user,
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
