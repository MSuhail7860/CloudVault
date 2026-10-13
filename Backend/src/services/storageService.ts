
import {
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const endpoint = process.env.S3_ENDPOINT;
const region = process.env.S3_REGION;
const bucket = process.env.S3_BUCKET;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

if (
  !endpoint ||
  !region ||
  !bucket ||
  !accessKeyId ||
  !secretAccessKey
) {
  throw new Error(
    "Missing required S3 configuration. Check your environment variables.",
  );
}

export const s3Client = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

export async function checkStorageConnection(): Promise<void> {
  await s3Client.send(
    new HeadBucketCommand({
      Bucket: bucket,
    }),
  );
}

interface UploadObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export async function uploadObject({
  key,
  body,
  contentType,
}: UploadObjectInput): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteObject(key: string): Promise<void> {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}
