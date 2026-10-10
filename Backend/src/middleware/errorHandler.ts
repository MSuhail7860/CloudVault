import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError.js";

type BodyParserError = SyntaxError & {
  status?: number;
  type?: string;
};

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (res.headersSent) {
    next(err);
    return;
  }

  // Handle malformed JSON sent by the client.
  if (err instanceof SyntaxError) {
    const parseError = err as BodyParserError;

    if (
      parseError.status === 400 &&
      parseError.type === "entity.parse.failed"
    ) {
      res.status(400).json({
        success: false,
        message: "Invalid JSON in request body",
      });

      return;
    }
  }

  // Handle known application errors.
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

  // Handle unexpected server errors.
  console.error(err);

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
};
