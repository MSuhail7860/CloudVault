import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  DeleteObjectCommand: class DeleteObjectCommand {
    constructor(public readonly input: unknown) {}
  },
  GetBucketVersioningCommand: class GetBucketVersioningCommand {
    constructor(public readonly input: unknown) {}
  },
  GetObjectCommand: class GetObjectCommand {
    constructor(public readonly input: unknown) {}
  },
  HeadBucketCommand: class HeadBucketCommand {
    constructor(public readonly input: unknown) {}
  },
  PutObjectCommand: class PutObjectCommand {
    constructor(public readonly input: unknown) {}
  },
  S3Client: class S3Client {
    send = mocks.send;
  },
}));

import {
  getStorageVersioningStatus,
  uploadObject,
  validateStorageVersioning,
} from "../storageService.js";

const originalEnvironment = {
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  bucket: process.env.S3_BUCKET,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
};

beforeEach(() => {
  process.env.S3_ENDPOINT = "http://storage.test";
  process.env.S3_REGION = "us-east-1";
  process.env.S3_BUCKET = "cloudvault-test";
  process.env.S3_ACCESS_KEY_ID = "test-value";
  process.env.S3_SECRET_ACCESS_KEY = "test-value";
  mocks.send.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();

  for (const [key, value] of Object.entries({
    S3_ENDPOINT: originalEnvironment.endpoint,
    S3_REGION: originalEnvironment.region,
    S3_BUCKET: originalEnvironment.bucket,
    S3_ACCESS_KEY_ID: originalEnvironment.accessKeyId,
    S3_SECRET_ACCESS_KEY: originalEnvironment.secretAccessKey,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("object-storage versioning preflight", () => {
  it("accepts a bucket with versioning disabled", async () => {
    mocks.send.mockResolvedValue({ Status: undefined });

    await expect(getStorageVersioningStatus()).resolves.toBe("DISABLED");
    await expect(validateStorageVersioning({ requireConfigured: true })).resolves.toBe(
      "DISABLED",
    );
  });

  describe("object-storage upload cancellation", () => {
    it("combines the request abort signal with the fixed storage timeout", async () => {
      const timeoutController = new AbortController();
      const timeoutSpy = vi
        .spyOn(AbortSignal, "timeout")
        .mockReturnValue(timeoutController.signal);
      const requestController = new AbortController();

      let combinedSignal: AbortSignal | undefined;
      mocks.send.mockImplementationOnce(
        (_command: unknown, options: { abortSignal: AbortSignal }) => {
          combinedSignal = options.abortSignal;
          return new Promise((_resolve, reject) => {
            options.abortSignal.addEventListener(
              "abort",
              () => reject(new Error("Storage operation aborted")),
              { once: true },
            );
          });
        },
      );

      const upload = uploadObject({
        key: "user/object",
        body: Buffer.from("safe test data"),
        contentType: "text/plain",
        abortSignal: requestController.signal,
      });
      expect(timeoutSpy).toHaveBeenCalledWith(30_000);
      expect(combinedSignal?.aborted).toBe(false);
      timeoutController.abort();

      await expect(upload).rejects.toThrow("Storage operation aborted");
      expect(combinedSignal?.aborted).toBe(true);
      timeoutSpy.mockRestore();
    });
  });

  it.each(["Enabled", "Suspended"]) (
    "rejects a bucket with versioning status %s",
    async (status) => {
      mocks.send.mockResolvedValue({ Status: status });

      await expect(getStorageVersioningStatus()).resolves.toBe("ENABLED");
      await expect(validateStorageVersioning({ requireConfigured: true })).rejects.toMatchObject({
        statusCode: 503,
        message: "Account deletion requires object-storage versioning to be disabled",
      });
    },
  );

  it("fails closed when versioning status is unavailable", async () => {
    mocks.send.mockRejectedValue(new Error("Access denied"));

    await expect(getStorageVersioningStatus()).resolves.toBe("UNAVAILABLE");
    await expect(validateStorageVersioning({ requireConfigured: true })).rejects.toMatchObject({
      statusCode: 503,
      message: "Object storage versioning status could not be established",
    });
  });

  it("does not block unconfigured local development but fails strict preflight", async () => {
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_REGION;
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;

    await expect(getStorageVersioningStatus()).resolves.toBe("NOT_CONFIGURED");
    await expect(validateStorageVersioning()).resolves.toBe("NOT_CONFIGURED");
    await expect(validateStorageVersioning({ requireConfigured: true })).rejects.toMatchObject({
      statusCode: 503,
      message: "Object storage is not configured; versioning cannot be validated",
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
