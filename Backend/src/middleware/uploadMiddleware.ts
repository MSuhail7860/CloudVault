import multer from "multer";
import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedRequest } from "./authMiddleware.js";
import {
  acquireUploadPermit,
  type UploadPermit,
} from "../services/uploadAdmissionService.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_MULTIPART_SIZE = 11 * 1024 * 1024;
export const UPLOAD_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;

export type UploadRequest = AuthenticatedRequest & {
  uploadAbortSignal?: AbortSignal;
  uploadTimedOut?: boolean;
};

const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
    fields: 1,
    fieldSize: 1024,
    parts: 2,
  },
});

const releasePermit = (permit: UploadPermit): void => {
  permit.release().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "upload_admission_release_failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  });
};

export const uploadAdmission = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const uploadRequest = req as UploadRequest;
  const userId = uploadRequest.userId;
  if (!userId) {
    res.status(401).json({
      success: false,
      message: "Authentication is required",
    });
    return;
  }

  const contentLength = req.headers["content-length"];
  if (
    typeof contentLength === "string" &&
    Number.isSafeInteger(Number(contentLength)) &&
    Number(contentLength) > MAX_MULTIPART_SIZE
  ) {
    res.status(413).json({
      success: false,
      message: "Upload request is too large",
    });
    return;
  }

  let admission: Awaited<ReturnType<typeof acquireUploadPermit>>;
  try {
    admission = await acquireUploadPermit(userId);
  } catch {
    res.status(503).json({
      success: false,
      message: "Upload admission is temporarily unavailable",
    });
    return;
  }

  if (admission.status !== "ADMITTED" || !admission.permit) {
    res.status(429).json({
      success: false,
      message:
        admission.status === "RATE_LIMIT"
          ? "Too many uploads. Please try again later."
          : "Too many concurrent uploads. Please try again shortly.",
    });
    return;
  }

  const permit = admission.permit;
  if (req.aborted || res.destroyed) {
    releasePermit(permit);
    return;
  }
  const abortController = new AbortController();
  uploadRequest.uploadAbortSignal = abortController.signal;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timeout);
    req.off("aborted", handleAbort);
    res.off("finish", handleFinish);
    res.off("close", handleClose);
    releasePermit(permit);
  };
  const handleAbort = () => {
    abortController.abort();
    release();
  };
  const handleFinish = () => release();
  const handleClose = () => {
    if (!res.writableFinished) abortController.abort();
    release();
  };
  const timeout = setTimeout(() => {
    uploadRequest.uploadTimedOut = true;
    abortController.abort();
    release();
    if (!res.headersSent && !res.destroyed) {
      res.status(408).json({
        success: false,
        message: "Upload request timed out",
      });
    }
  }, UPLOAD_REQUEST_TIMEOUT_MS);
  timeout.unref();

  req.once("aborted", handleAbort);
  res.once("finish", handleFinish);
  res.once("close", handleClose);
  try {
    next();
  } catch (error) {
    abortController.abort();
    release();
    throw error;
  }
};
