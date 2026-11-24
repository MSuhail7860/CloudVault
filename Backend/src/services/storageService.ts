import {
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { AppError } from "../utils/AppError.js";

export type StorageVersioningStatus =
  | "DISABLED"
  | "ENABLED"
  | "UNAVAILABLE"
  | "NOT_CONFIGURED";

interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

let cachedClient: S3Client | null = null;
let cachedConfigKey: string | null = null;

const getStorageConfig = (): StorageConfig | null => {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
};

const requireStorageConfig = (): StorageConfig => {
  const config = getStorageConfig();

  if (!config) {
    throw new AppError("Object storage is not configured", 503);
  }

  return config;
};

const getS3Client = (config: StorageConfig): S3Client => {
  const configKey = [
    config.endpoint,
    config.region,
    config.bucket,
    config.accessKeyId,
    config.secretAccessKey,
  ].join("\u0000");

  if (cachedClient && cachedConfigKey === configKey) return cachedClient;

  cachedClient = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  cachedConfigKey = configKey;

  return cachedClient;
};

export const getStorageVersioningStatus = async (): Promise<StorageVersioningStatus> => {
  const config = getStorageConfig();
  if (!config) return "NOT_CONFIGURED";

  try {
    const response = await getS3Client(config).send(
      new GetBucketVersioningCommand({ Bucket: config.bucket }),
    );

    return response.Status === "Enabled" || response.Status === "Suspended"
      ? "ENABLED"
      : "DISABLED";
  } catch {
    return "UNAVAILABLE";
  }
};

/**
 * Account deletion uses DeleteObject and therefore requires a bucket that has
 * never had versioning enabled. Suspended versioning can still retain old
 * versions, so it is rejected as well.
 */
export const validateStorageVersioning = async (options?: {
  requireConfigured?: boolean;
}): Promise<StorageVersioningStatus> => {
  const status = await getStorageVersioningStatus();

  if (status === "NOT_CONFIGURED") {
    if (options?.requireConfigured) {
      throw new AppError(
        "Object storage is not configured; versioning cannot be validated",
        503,
      );
    }
    return status;
  }

  if (status === "UNAVAILABLE") {
    throw new AppError(
      "Object storage versioning status could not be established",
      503,
    );
  }

  if (status === "ENABLED") {
    throw new AppError(
      "Account deletion requires object-storage versioning to be disabled",
      503,
    );
  }

  return status;
};

/**
 * Verify that the configured object-storage bucket is accessible.
 */
export async function checkStorageConnection(): Promise<void> {
  const config = requireStorageConfig();
  await getS3Client(config).send(
    new HeadBucketCommand({
      Bucket: config.bucket,
    }),
  );
}

interface UploadObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
  abortSignal?: AbortSignal;
}

const STORAGE_UPLOAD_TIMEOUT_MS = 30_000;

/**
 * Upload a file to object storage.
 */
export async function uploadObject({
  key,
  body,
  contentType,
  abortSignal,
}: UploadObjectInput): Promise<void> {
  const config = requireStorageConfig();
  await getS3Client(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
    {
      abortSignal: AbortSignal.any([
        abortSignal ?? new AbortController().signal,
        AbortSignal.timeout(STORAGE_UPLOAD_TIMEOUT_MS),
      ]),
    },
  );
}

/**
 * Download an object from storage.
 * The caller must verify database ownership before calling this function.
 */
export async function downloadObject(key: string) {
  const config = requireStorageConfig();
  const response = await getS3Client(config).send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
  );

  if (!response.Body) {
    throw new Error(
      "File content is empty or unavailable in storage.",
    );
  }

  return response;
}

/**
 * Delete a file from object storage.
 */
export async function deleteObject(key: string): Promise<void> {
  const config = requireStorageConfig();
  await getS3Client(config).send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
  );
}
