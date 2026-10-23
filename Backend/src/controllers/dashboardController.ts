import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { getDashboardStats } from "../services/dashboardService.js";

export const getDashboard = async (
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

    const stats = await getDashboardStats(req.userId);

    res.status(200).json({
      success: true,
      message: "Dashboard retrieved successfully",
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};
