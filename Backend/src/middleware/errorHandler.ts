
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError.js";

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (res.headersSent) {
    return;
  }

  if (err instanceof AppError) {
    if (!err.isOperational) {
      console.error(err);
    }

    res.status(err.statusCode).json({
      success: false,
      message: err.isOperational
        ? err.message
        : "Internal server error",
    });

    return;
  }

  console.error(err);

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
};
