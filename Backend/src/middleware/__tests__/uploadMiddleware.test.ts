import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../authMiddleware.js";

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
}));

vi.mock("../../services/uploadAdmissionService.js", () => ({
  acquireUploadPermit: mocks.acquire,
}));

import {
  uploadAdmission,
  UPLOAD_REQUEST_TIMEOUT_MS,
  type UploadRequest,
} from "../uploadMiddleware.js";

const requestFor = (
  userId: string,
  contentLength?: string,
): Request & UploadRequest & EventEmitter => {
  const request = Object.assign(new EventEmitter(), {
    userId,
    headers: contentLength ? { "content-length": contentLength } : {},
  });
  return request as unknown as Request & UploadRequest & EventEmitter;
};

const responseFor = () => {
  const response = new EventEmitter() as EventEmitter & {
    statusCode: number;
    body?: unknown;
    headersSent: boolean;
    destroyed: boolean;
    writableFinished: boolean;
    status: (code: number) => typeof response;
    json: (body: unknown) => typeof response;
  };
  response.statusCode = 0;
  response.headersSent = false;
  response.destroyed = false;
  response.writableFinished = false;
  response.status = (code) => {
    response.statusCode = code;
    return response;
  };
  response.json = (body) => {
    response.body = body;
    response.headersSent = true;
    return response;
  };
  return response as unknown as Response & typeof response;
};

const admitted = () => ({
  status: "ADMITTED" as const,
  permit: { release: mocks.release },
});

beforeEach(() => {
  mocks.acquire.mockResolvedValue(admitted());
  mocks.release.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("uploadAdmission", () => {
  it("requests a distributed permit and releases it after response completion", async () => {
    const response = responseFor();
    const next = vi.fn();

    await uploadAdmission(requestFor("admission-test-user"), response, next);

    expect(mocks.acquire).toHaveBeenCalledWith("admission-test-user");
    expect(next).toHaveBeenCalledOnce();
    response.writableFinished = true;
    response.emit("finish");
    await Promise.resolve();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("rejects oversized multipart requests before admission", async () => {
    const response = responseFor();
    const next = vi.fn();

    await uploadAdmission(
      requestFor("oversize-test-user", String(12 * 1024 * 1024)),
      response,
      next,
    );

    expect(response.statusCode).toBe(413);
    expect(mocks.acquire).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("releases the permit and aborts storage work when the client disconnects", async () => {
    const req = requestFor("aborted-test-user");
    const response = responseFor();

    await uploadAdmission(req, response, vi.fn());
    req.emit("aborted");
    response.emit("close");
    await Promise.resolve();

    expect(req.uploadAbortSignal?.aborted).toBe(true);
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(req.listenerCount("aborted")).toBe(0);
    expect(response.listenerCount("finish")).toBe(0);
    expect(response.listenerCount("close")).toBe(0);
  });

  it("aborts ongoing work and returns 408 at the request deadline", async () => {
    vi.useFakeTimers();
    const req = requestFor("timeout-test-user");
    const response = responseFor();

    await uploadAdmission(req, response, vi.fn());
    await vi.advanceTimersByTimeAsync(UPLOAD_REQUEST_TIMEOUT_MS);

    expect(req.uploadAbortSignal?.aborted).toBe(true);
    expect(req.uploadTimedOut).toBe(true);
    expect(response.statusCode).toBe(408);
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(req.listenerCount("aborted")).toBe(0);
  });

  it("releases a permit if downstream middleware throws synchronously", async () => {
    const req = requestFor("throw-test-user");
    const response = responseFor();
    const error = new Error("middleware failure");

    await expect(
      uploadAdmission(req, response, () => {
        throw error;
      }),
    ).rejects.toBe(error);

    expect(req.uploadAbortSignal?.aborted).toBe(true);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("fails closed when the distributed admission service is unavailable", async () => {
    mocks.acquire.mockRejectedValueOnce(new Error("Redis connection detail"));
    const response = responseFor();
    const next = vi.fn();

    await uploadAdmission(requestFor("redis-down-user"), response, next);

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      success: false,
      message: "Upload admission is temporarily unavailable",
    });
    expect(JSON.stringify(response.body)).not.toContain("Redis connection detail");
    expect(next).not.toHaveBeenCalled();
  });
});
