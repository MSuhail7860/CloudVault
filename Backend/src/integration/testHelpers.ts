import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { prisma } from "../config/database.js";
import { deleteObject, uploadObject } from "../services/storageService.js";

export const TEST_PASSWORD = "integration-test-password";

const createdUserIds = new Set<string>();
const createdStorageKeys = new Set<string>();

export const createTestUser = async (suffix = randomUUID()) => {
  const user = await prisma.user.create({
    data: {
      email: `integration-${suffix}@example.test`,
      passwordHash: await bcrypt.hash(TEST_PASSWORD, 12),
      name: "Integration Test User",
    },
    select: { id: true, email: true },
  });

  createdUserIds.add(user.id);
  return user;
};

export const createStoredFile = async (ownerId: string, suffix = randomUUID()) => {
  const storageKey = `${ownerId}/${suffix}`;
  await uploadObject({
    key: storageKey,
    body: Buffer.from("CloudVault integration test object"),
    contentType: "text/plain",
  });
  createdStorageKeys.add(storageKey);

  const file = await prisma.file.create({
    data: {
      name: `integration-${suffix}.txt`,
      originalName: `integration-${suffix}.txt`,
      storageKey,
      mimeType: "text/plain",
      size: BigInt(35),
      ownerId,
      processingStatus: "COMPLETED",
    },
    select: { id: true, storageKey: true },
  });

  return file;
};

export const createStoredVersion = async (
  ownerId: string,
  fileId: string,
  version: number,
) => {
  const storageKey = `${ownerId}/version-${randomUUID()}`;
  await uploadObject({
    key: storageKey,
    body: Buffer.from(`CloudVault integration version ${version}`),
    contentType: "text/plain",
  });
  createdStorageKeys.add(storageKey);

  return prisma.fileVersion.create({
    data: {
      fileId,
      version,
      storageKey,
      mimeType: "text/plain",
      size: BigInt(35),
    },
    select: { id: true, storageKey: true },
  });
};

export const cleanupTestState = async (): Promise<void> => {
  for (const storageKey of createdStorageKeys) {
    try {
      await deleteObject(storageKey);
    } catch {
      // The account-deletion worker may already have removed the object.
    }
  }

  if (createdUserIds.size) {
    await prisma.user.deleteMany({
      where: { id: { in: [...createdUserIds] } },
    });
  }

  createdStorageKeys.clear();
  createdUserIds.clear();
};

export const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};

export const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
