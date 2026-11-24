import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export const REQUEST_ID_HEADER = "x-request-id";
const VALID_REQUEST_ID_REGEX = /^[a-zA-Z0-9_\-.]{1,128}$/;

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

/**
 * Extracts an incoming X-Request-ID header or generates a cryptographically
 * secure random UUID. Assigns it to req.id and sets X-Request-ID on the response.
 */
export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const requestId =
    typeof incoming === "string" && VALID_REQUEST_ID_REGEX.test(incoming.trim())
      ? incoming.trim()
      : randomUUID();

  req.id = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
};
