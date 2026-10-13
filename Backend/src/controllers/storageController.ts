
import type { Request, Response, NextFunction } from "express";
import { checkStorageConnection } from "../services/storageService.js";

export async function storageHealth(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await checkStorageConnection();

    res.status(200).json({
      success: true,
      message: "Object storage is connected",
    });
  } catch (error) {
    next(error);
  }
}
