import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockUpdate, mockDownloadObject } = vi.hoisted(
  () => ({
    mockFindUnique: vi.fn(),
    mockUpdate: vi.fn(),
    mockDownloadObject: vi.fn(),
  }),
);

vi.mock("../../../config/database.js", () => ({
  prisma: {
    file: {
      findUnique: mockFindUnique,
      updateMany: mockUpdate,
    },
    $transaction: async (
      callback: (transaction: unknown) => Promise<unknown>,
    ) => callback({
      file: { updateMany: mockUpdate },
      $executeRaw: async () => 1,
    }),
  },
}));

vi.mock("../../../services/storageService.js", () => ({
  downloadObject: mockDownloadObject,
}));

import { downloadObject } from "../../../services/storageService.js";
import { processFileJob } from "../fileProcessor.js";

const storageDownload = vi.mocked(downloadObject);

const fileId = "file-1";
const storageKey = "user-1/file-1";

const activeFile = {
  id: fileId,
  name: "report.txt",
  mimeType: "text/plain",
  size: BigInt(20),
  storageKey,
  ownerId: "user-1",
  deletedAt: null,
  metadata: { source: "upload" },
};

const mockStorageBody = (content: string) => ({
  transformToByteArray: async () =>
    new Uint8Array(Buffer.from(content)),
});

beforeEach(() => {
  vi.resetAllMocks();
  mockUpdate.mockResolvedValue({ count: 1 });
});

describe("processFileJob", () => {
  it("does nothing when the file does not exist", async () => {
    mockFindUnique.mockResolvedValue(null);

    await processFileJob({ fileId });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(storageDownload).not.toHaveBeenCalled();
  });

  it("does nothing when the file is in Trash", async () => {
    mockFindUnique.mockResolvedValue({
      ...activeFile,
      deletedAt: new Date(),
    } as never);

    await processFileJob({ fileId });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(storageDownload).not.toHaveBeenCalled();
  });

  it("processes a text file and extracts line and character counts", async () => {
    const content = "Hello\nCloudVault\nTesting";

    mockFindUnique.mockResolvedValue(activeFile as never);
    storageDownload.mockResolvedValue({
      Body: mockStorageBody(content),
    } as never);

    await processFileJob({ fileId });

    expect(storageDownload).toHaveBeenCalledWith(storageKey);
    expect(mockUpdate).toHaveBeenCalledTimes(2);

    expect(mockUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ id: fileId }),
        data: { processingStatus: "PROCESSING" },
      }),
    );

    const completedUpdate = mockUpdate.mock.calls[1]![0];

    expect(completedUpdate.data).toMatchObject({
      processingStatus: "COMPLETED",
      metadata: {
        source: "upload",
        mimeType: "text/plain",
        sizeBytes: "20",
        lineCount: 3,
        characterCount: content.length,
        hasPreview: true,
      },
    });
  });

  it("processes an image file", async () => {
    mockFindUnique.mockResolvedValue({
      ...activeFile,
      name: "photo.png",
      mimeType: "image/png",
    } as never);

    await processFileJob({ fileId });

    expect(storageDownload).not.toHaveBeenCalled();

    expect(mockUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processingStatus: "COMPLETED",
          metadata: expect.objectContaining({
            category: "image",
            isImage: true,
            hasPreview: true,
          }),
        }),
      }),
    );
  });

  it("processes a PDF file", async () => {
    mockFindUnique.mockResolvedValue({
      ...activeFile,
      name: "report.pdf",
      mimeType: "application/pdf",
    } as never);

    await processFileJob({ fileId });

    expect(mockUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processingStatus: "COMPLETED",
          metadata: expect.objectContaining({
            category: "document",
            isPdf: true,
            hasPreview: true,
          }),
        }),
      }),
    );
  });

  it("marks the file as FAILED when text content is missing", async () => {
    mockFindUnique
      .mockResolvedValueOnce(activeFile as never)
      .mockResolvedValueOnce({
        metadata: { source: "upload" },
      } as never);

    storageDownload.mockResolvedValue({ Body: undefined } as never);

    await expect(processFileJob({ fileId })).rejects.toThrow(
      "File content could not be downloaded from storage.",
    );

    expect(mockUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processingStatus: "FAILED",
          metadata: expect.objectContaining({
            source: "upload",
            error: "File content could not be downloaded from storage.",
          }),
        }),
      }),
    );
  });

  it("marks the file as FAILED and rethrows a storage error", async () => {
    const storageError = new Error("Storage unavailable");

    mockFindUnique
      .mockResolvedValueOnce(activeFile as never)
      .mockResolvedValueOnce({
        metadata: { source: "upload" },
      } as never);

    storageDownload.mockRejectedValue(storageError);

    await expect(processFileJob({ fileId })).rejects.toBe(storageError);

    expect(mockUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processingStatus: "FAILED",
          metadata: expect.objectContaining({
            source: "upload",
            error: "Storage unavailable",
          }),
        }),
      }),
    );
  });

  it("preserves the original error if updating FAILED status also fails", async () => {
    const storageError = new Error("Storage unavailable");

    mockFindUnique
      .mockResolvedValueOnce(activeFile as never)
      .mockRejectedValueOnce(new Error("Database unavailable"));

    storageDownload.mockRejectedValue(storageError);

    await expect(processFileJob({ fileId })).rejects.toBe(storageError);
  });
});
