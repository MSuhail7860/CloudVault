import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/database.js", () => ({
  prisma: {
    folder: {
      findFirst: vi.fn(),
    },
    file: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    fileVersion: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../storageService.js", () => ({
  uploadObject: vi.fn(),
  downloadObject: vi.fn(),
  deleteObject: vi.fn(),
}));

import { prisma } from "../../config/database.js";
import {
  uploadObject,
  downloadObject,
  deleteObject,
} from "../storageService.js";
import {
  uploadFile,
  listFiles,
  getFileForDownload,
  renameFile,
  moveFileToTrash,
  listTrashedFiles,
  restoreFileFromTrash,
  permanentlyDeleteFile,
  uploadFileVersion,
  listFileVersions,
  restoreFileVersion,
} from "../fileService.js";

const db = vi.mocked(prisma);
const storageUpload = vi.mocked(uploadObject);
const storageDownload = vi.mocked(downloadObject);
const storageDelete = vi.mocked(deleteObject);

const ownerId = "user-1";
const fileId = "file-1";
const storageKey = `${ownerId}/storage-object-1`;

const activeFile = {
  id: fileId,
  name: "report.pdf",
  originalName: "report.pdf",
  mimeType: "application/pdf",
  size: BigInt(1024),
  storageKey,
  ownerId,
  folderId: null,
  createdAt: new Date("2026-10-01T10:00:00Z"),
  updatedAt: new Date("2026-10-01T10:00:00Z"),
};

const appError = async (
  promise: Promise<unknown>,
  message: string,
  statusCode: number,
) => {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toMatchObject({ message, statusCode });
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("uploadFile", () => {
  const input = {
    ownerId,
    originalName: " report.pdf ",
    mimeType: "application/pdf",
    buffer: Buffer.from("test file"),
  };

  it("uploads a file and creates its database record", async () => {
    vi.mocked(db.file.create).mockResolvedValue({
      ...activeFile,
      name: "report.pdf",
      originalName: "report.pdf",
    } as never);

    const result = await uploadFile(input);

    expect(storageUpload).toHaveBeenCalledOnce();
    expect(storageUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        body: input.buffer,
        contentType: input.mimeType,
      }),
    );

    const uploadArgs = storageUpload.mock.calls[0]![0];

    expect(uploadArgs.key).toMatch(new RegExp(`^${ownerId}/`));
    expect(uploadArgs.key).not.toContain("report.pdf");

    expect(db.file.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "report.pdf",
          originalName: "report.pdf",
          ownerId,
          mimeType: "application/pdf",
          size: BigInt(input.buffer.length),
          folderId: null,
        }),
      }),
    );

    expect(result).toBeDefined();
  });

  it("rejects an empty filename", async () => {
    await appError(
      uploadFile({ ...input, originalName: "   " }),
      "File name cannot be empty",
      400,
    );

    expect(storageUpload).not.toHaveBeenCalled();
  });

  it("rejects an empty file", async () => {
    await appError(
      uploadFile({ ...input, buffer: Buffer.alloc(0) }),
      "Uploaded file is empty",
      400,
    );

    expect(storageUpload).not.toHaveBeenCalled();
  });

  it("rejects a file larger than 10 MB", async () => {
    await appError(
      uploadFile({
        ...input,
        buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
      }),
      "File size cannot exceed 10 MB",
      413,
    );

    expect(storageUpload).not.toHaveBeenCalled();
  });

  it("rejects an invalid content type", async () => {
    await appError(
      uploadFile({ ...input, mimeType: "" }),
      "A valid content type is required",
      400,
    );

    expect(storageUpload).not.toHaveBeenCalled();
  });

  it("rejects a folder that does not belong to the user", async () => {
    vi.mocked(db.folder.findFirst).mockResolvedValue(null);

    await appError(
      uploadFile({ ...input, folderId: "other-users-folder" }),
      "Folder not found",
      404,
    );

    expect(storageUpload).not.toHaveBeenCalled();
    expect(db.file.create).not.toHaveBeenCalled();
  });

  it("cleans up storage if database creation fails", async () => {
    const dbError = new Error("Database unavailable");

    vi.mocked(db.file.create).mockRejectedValue(dbError);
    storageDelete.mockResolvedValue(undefined);

    await expect(uploadFile(input)).rejects.toBe(dbError);

    expect(storageUpload).toHaveBeenCalledOnce();
    expect(storageDelete).toHaveBeenCalledWith(
      storageUpload.mock.calls[0]![0].key,
    );
  });

  it("preserves the database error if storage cleanup also fails", async () => {
    const dbError = new Error("Database unavailable");

    vi.mocked(db.file.create).mockRejectedValue(dbError);
    storageDelete.mockRejectedValue(new Error("Storage unavailable"));

    await expect(uploadFile(input)).rejects.toBe(dbError);
  });
});

describe("listFiles", () => {
  it("lists active files and converts BigInt sizes to strings", async () => {
    vi.mocked(db.file.findMany).mockResolvedValue([activeFile] as never);

    const result = await listFiles({ ownerId });

    expect(db.file.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId, folderId: null, deletedAt: null },
        orderBy: { createdAt: "desc" },
      }),
    );

    expect(result[0]!.size).toBe("1024");
  });

  it("filters by the requested folder", async () => {
    vi.mocked(db.file.findMany).mockResolvedValue([]);

    await listFiles({ ownerId, folderId: "folder-1" });

    expect(db.file.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerId,
          folderId: "folder-1",
          deletedAt: null,
        },
      }),
    );
  });
});

describe("getFileForDownload", () => {
  it("downloads an active file belonging to the user", async () => {
    vi.mocked(db.file.findFirst).mockResolvedValue(activeFile as never);

    const object = { body: "mock file body" };
    storageDownload.mockResolvedValue(object as never);

    const result = await getFileForDownload({ fileId, ownerId });

    expect(db.file.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: fileId, ownerId, deletedAt: null },
      }),
    );
    expect(storageDownload).toHaveBeenCalledWith(storageKey);
    expect(result.file.size).toBe("1024");
    expect(result.object).toBe(object);
  });

  it("rejects a missing or inaccessible file", async () => {
    vi.mocked(db.file.findFirst).mockResolvedValue(null);

    await appError(
      getFileForDownload({ fileId, ownerId }),
      "File not found",
      404,
    );

    expect(storageDownload).not.toHaveBeenCalled();
  });
});

describe("renameFile", () => {
  it("renames an active file", async () => {
    vi.mocked(db.file.findFirst).mockResolvedValue({ id: fileId } as never);

    vi.mocked(db.file.update).mockResolvedValue({
      ...activeFile,
      name: "new-name.pdf",
      originalName: "new-name.pdf",
    } as never);

    await renameFile({ fileId, ownerId, newName: " new-name.pdf " });

    expect(db.file.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: fileId },
        data: {
          name: "new-name.pdf",
          originalName: "new-name.pdf",
        },
      }),
    );
  });

  it("rejects an empty name", async () => {
    await appError(
      renameFile({ fileId, ownerId, newName: "  " }),
      "File name cannot be empty",
      400,
    );

    expect(db.file.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a missing or inaccessible file", async () => {
    vi.mocked(db.file.findFirst).mockResolvedValue(null);

    await appError(
      renameFile({ fileId, ownerId, newName: "new.pdf" }),
      "File not found",
      404,
    );

    expect(db.file.update).not.toHaveBeenCalled();
  });
});

describe("moveFileToTrash", () => {
  it("moves an active file to Trash without deleting storage", async () => {
    vi.mocked(db.file.findFirst).mockResolvedValue({ id: fileId } as never);

    vi.mocked(db.file.update).mockResolvedValue({
      id: fileId,
      name: "report.pdf",
      deletedAt: new Date(),
    } as never);

    await moveFileToTrash({ fileId, ownerId });

    expect(db.file.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: fileId },
        data: { deletedAt: expect.any(Date) },
      }),
    );

    expect(storageDelete).not.toHaveBeenCalled();
  });

  it("rejects a missing or inaccessible file", async () => {
    vi.mocked(db.file.findFirst).mockResolvedValue(null);

    await appError(
      moveFileToTrash({ fileId, ownerId }),
      "File not found",
      404,
    );

    expect(db.file.update).not.toHaveBeenCalled();
  });
});

describe("listTrashedFiles", () => {
  it("lists trashed files and converts sizes to strings", async () => {
    vi.mocked(db.file.findMany).mockResolvedValue([
      { ...activeFile, deletedAt: new Date() },
    ] as never);

    const result = await listTrashedFiles({ ownerId });

    expect(db.file.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerId,
          deletedAt: { not: null },
        },
        orderBy: { deletedAt: "desc" },
      }),
    );

    expect(result[0]!.size).toBe("1024");
  });
});

describe("restoreFileFromTrash", () => {
  it("restores a trashed file", async () => {
    vi.mocked(db.file.findFirst).mockResolvedValue({ id: fileId } as never);

    vi.mocked(db.file.update).mockResolvedValue({ ...activeFile } as never);

    await restoreFileFromTrash({ fileId, ownerId });

    expect(db.file.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: fileId,
          ownerId,
          deletedAt: { not: null },
        },
      }),
    );

    expect(db.file.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: fileId },
        data: { deletedAt: null },
      }),
    );
  });

  it("rejects a file that is not in Trash", async () => {
    vi.mocked(db.file.findFirst).mockResolvedValue(null);

    await appError(
      restoreFileFromTrash({ fileId, ownerId }),
      "Trashed file not found",
      404,
    );

    expect(db.file.update).not.toHaveBeenCalled();
  });
});

describe("permanentlyDeleteFile", () => {
  it("deletes storage and the database record for a trashed file", async () => {
    vi.mocked(db.file.findFirst).mockResolvedValue({
      id: fileId,
      storageKey,
      versions: [],
    } as never);

    storageDelete.mockResolvedValue(undefined);
    vi.mocked(db.file.delete).mockResolvedValue({ id: fileId } as never);

    const result = await permanentlyDeleteFile({ fileId, ownerId });

    expect(db.file.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: fileId,
          ownerId,
          deletedAt: { not: null },
        },
      }),
    );

    expect(storageDelete).toHaveBeenCalledWith(storageKey);
    expect(db.file.delete).toHaveBeenCalledWith({
      where: { id: fileId },
      select: { id: true },
    });
    expect(result).toEqual({ id: fileId });
  });

  it("rejects a file that is not in Trash", async () => {
    vi.mocked(db.file.findFirst).mockResolvedValue(null);

    await appError(
      permanentlyDeleteFile({ fileId, ownerId }),
      "Trashed file not found",
      404,
    );

    expect(storageDelete).not.toHaveBeenCalled();
    expect(db.file.delete).not.toHaveBeenCalled();
  });

  it("preserves the database record if storage deletion fails", async () => {
    vi.mocked(db.file.findFirst).mockResolvedValue({
      id: fileId,
      storageKey,
      versions: [],
    } as never);

    storageDelete.mockRejectedValue(new Error("Storage unavailable"));

    await expect(
      permanentlyDeleteFile({ fileId, ownerId }),
    ).rejects.toThrow("Storage unavailable");

    expect(db.file.delete).not.toHaveBeenCalled();
  });
});

describe("uploadFileVersion", () => {
  it("saves the previous content and updates the file to the new version", async () => {
    const buffer = Buffer.from("new PDF content");
    const previousSize = BigInt(1024);
    const newSize = BigInt(buffer.length);
    const now = new Date();

    vi.mocked(db.file.findFirst).mockResolvedValueOnce({
      id: fileId,
      storageKey,
      mimeType: "application/pdf",
      size: previousSize,
    } as never);

    const tx = {
      file: {
        findFirst: vi.fn().mockResolvedValue({
          id: fileId,
          storageKey,
          mimeType: "application/pdf",
          size: previousSize,
        }),
        update: vi.fn().mockResolvedValue({
          id: fileId,
          name: "report.pdf",
          originalName: "report.pdf",
          mimeType: "application/pdf",
          size: newSize,
          updatedAt: now,
        }),
      },
      fileVersion: {
        findFirst: vi.fn().mockResolvedValue({ version: 1 }),
        create: vi.fn().mockResolvedValue({
          id: "version-2",
          version: 2,
          mimeType: "application/pdf",
          size: previousSize,
          createdAt: now,
        }),
      },
    };

    vi.mocked(db.$transaction).mockImplementation(
      (async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback(tx)) as never,
    );

    storageUpload.mockResolvedValue(undefined);

    const result = await uploadFileVersion({
      fileId,
      ownerId,
      originalName: "report.pdf",
      mimeType: "application/pdf",
      buffer,
    });

    expect(storageUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        body: buffer,
        contentType: "application/pdf",
      }),
    );

    expect(tx.fileVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fileId,
          version: 2,
          storageKey,
          mimeType: "application/pdf",
          size: previousSize,
        }),
      }),
    );

    expect(tx.file.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: fileId },
        data: expect.objectContaining({
          name: "report.pdf",
          originalName: "report.pdf",
          mimeType: "application/pdf",
          size: newSize,
        }),
      }),
    );

    expect(result.version.version).toBe(2);
    expect(result.version.size).toBe(previousSize.toString());
    expect(result.file.size).toBe(newSize.toString());
  });

  it("rejects a missing or inaccessible file", async () => {
    vi.mocked(db.file.findFirst).mockResolvedValueOnce(null);

    await appError(
      uploadFileVersion({
        fileId,
        ownerId,
        originalName: "report.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("new content"),
      }),
      "File not found",
      404,
    );

    expect(storageUpload).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("deletes the newly uploaded object when the database transaction fails", async () => {
    const databaseError = new Error("Database transaction failed");

    vi.mocked(db.file.findFirst).mockResolvedValueOnce({
      id: fileId,
      storageKey,
      mimeType: "application/pdf",
      size: BigInt(1024),
    } as never);

    storageUpload.mockResolvedValue(undefined);
    vi.mocked(db.$transaction).mockRejectedValueOnce(databaseError);
    storageDelete.mockResolvedValue(undefined);

    await expect(
      uploadFileVersion({
        fileId,
        ownerId,
        originalName: "report.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("new content"),
      }),
    ).rejects.toBe(databaseError);

    expect(storageUpload).toHaveBeenCalledOnce();
    expect(storageDelete).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${ownerId}/`)),
    );
  });
});

describe("listFileVersions", () => {
  it("lists versions in descending order and converts sizes to strings", async () => {
    const now = new Date();

    vi.mocked(db.file.findFirst).mockResolvedValueOnce({
      id: fileId,
    } as never);

    vi.mocked(db.fileVersion.findMany).mockResolvedValueOnce([
      {
        id: "version-2",
        version: 2,
        mimeType: "application/pdf",
        size: BigInt(2048),
        createdAt: now,
      },
      {
        id: "version-1",
        version: 1,
        mimeType: "application/pdf",
        size: BigInt(1024),
        createdAt: now,
      },
    ] as never);

    const result = await listFileVersions({ fileId, ownerId });

    expect(db.fileVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { fileId },
        orderBy: { version: "desc" },
      }),
    );

    expect(result).toHaveLength(2);
    expect(result[0]!.version).toBe(2);
    expect(result[0]!.size).toBe("2048");
    expect(result[1]!.version).toBe(1);
    expect(result[1]!.size).toBe("1024");
  });

  it("rejects a missing or trashed file", async () => {
    vi.mocked(db.file.findFirst).mockResolvedValueOnce(null);

    await appError(
      listFileVersions({ fileId, ownerId }),
      "File not found",
      404,
    );

    expect(db.fileVersion.findMany).not.toHaveBeenCalled();
  });
});

describe("restoreFileVersion", () => {
  it("restores historical content and preserves the replaced content", async () => {
    const historicalContent = Buffer.from("previous PDF content");
    const historicalSize = BigInt(historicalContent.length);
    const currentSize = BigInt(1024);
    const now = new Date();

    vi.mocked(db.file.findFirst).mockResolvedValueOnce({
      id: fileId,
      storageKey,
      mimeType: "application/pdf",
      size: currentSize,
    } as never);

    vi.mocked(db.fileVersion.findFirst).mockResolvedValueOnce({
      id: "version-1",
      storageKey: `${ownerId}/old-object`,
      mimeType: "application/pdf",
      size: historicalSize,
    } as never);

    storageDownload.mockResolvedValueOnce({
      Body: {
        transformToByteArray: async () =>
          new Uint8Array(historicalContent),
      },
    } as never);

    const tx = {
      file: {
        findFirst: vi.fn().mockResolvedValue({
          id: fileId,
          storageKey,
          mimeType: "application/pdf",
          size: currentSize,
        }),
        update: vi.fn().mockResolvedValue({
          id: fileId,
          name: "report.pdf",
          originalName: "report.pdf",
          mimeType: "application/pdf",
          size: historicalSize,
          updatedAt: now,
        }),
      },
      fileVersion: {
        findFirst: vi.fn().mockResolvedValue({ version: 1 }),
        create: vi.fn().mockResolvedValue({
          id: "version-2",
          version: 2,
          mimeType: "application/pdf",
          size: currentSize,
          createdAt: now,
        }),
      },
    };

    vi.mocked(db.$transaction).mockImplementation(
      (async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback(tx)) as never,
    );

    storageUpload.mockResolvedValue(undefined);

    const result = await restoreFileVersion({
      fileId,
      versionId: "version-1",
      ownerId,
    });

    expect(storageDownload).toHaveBeenCalledWith(
      `${ownerId}/old-object`,
    );

    expect(storageUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        body: historicalContent,
        contentType: "application/pdf",
      }),
    );

    expect(tx.fileVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fileId,
          version: 2,
          storageKey,
          mimeType: "application/pdf",
          size: currentSize,
        }),
      }),
    );

    expect(tx.file.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: fileId },
        data: expect.objectContaining({
          storageKey: expect.stringMatching(new RegExp(`^${ownerId}/`)),
          mimeType: "application/pdf",
          size: historicalSize,
        }),
      }),
    );

    expect(result.savedCurrentVersion.version).toBe(2);
    expect(result.savedCurrentVersion.size).toBe(currentSize.toString());
    expect(result.file.size).toBe(historicalSize.toString());
  });

  it("rejects a missing or trashed file", async () => {
    vi.mocked(db.file.findFirst).mockResolvedValueOnce(null);

    await appError(
      restoreFileVersion({
        fileId,
        versionId: "version-1",
        ownerId,
      }),
      "File not found",
      404,
    );

    expect(db.fileVersion.findFirst).not.toHaveBeenCalled();
    expect(storageDownload).not.toHaveBeenCalled();
  });

  it("rejects a version that does not belong to the file", async () => {
    vi.mocked(db.file.findFirst).mockResolvedValueOnce({
      id: fileId,
      storageKey,
      mimeType: "application/pdf",
      size: BigInt(1024),
    } as never);

    vi.mocked(db.fileVersion.findFirst).mockResolvedValueOnce(null);

    await appError(
      restoreFileVersion({
        fileId,
        versionId: "missing-version",
        ownerId,
      }),
      "File version not found",
      404,
    );

    expect(storageDownload).not.toHaveBeenCalled();
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it("deletes the restored object when the database transaction fails", async () => {
    const databaseError = new Error("Database transaction failed");

    vi.mocked(db.file.findFirst).mockResolvedValueOnce({
      id: fileId,
      storageKey,
      mimeType: "application/pdf",
      size: BigInt(1024),
    } as never);

    vi.mocked(db.fileVersion.findFirst).mockResolvedValueOnce({
      id: "version-1",
      storageKey: `${ownerId}/old-object`,
      mimeType: "application/pdf",
      size: BigInt(20),
    } as never);

    storageDownload.mockResolvedValueOnce({
      Body: {
        transformToByteArray: async () =>
          new Uint8Array(Buffer.from("historical content")),
      },
    } as never);

    storageUpload.mockResolvedValue(undefined);
    vi.mocked(db.$transaction).mockRejectedValueOnce(databaseError);
    storageDelete.mockResolvedValue(undefined);

    await expect(
      restoreFileVersion({
        fileId,
        versionId: "version-1",
        ownerId,
      }),
    ).rejects.toBe(databaseError);

    expect(storageUpload).toHaveBeenCalledOnce();
    expect(storageDelete).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${ownerId}/`)),
    );
  });
});
