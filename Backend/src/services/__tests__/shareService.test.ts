import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/database.js", () => ({
  prisma: {
    file: {
      findFirst: vi.fn(),
    },
    shareLink: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../storageService.js", () => ({
  downloadObject: vi.fn(),
}));

import { prisma } from "../../config/database.js";
import { downloadObject } from "../storageService.js";
import {
  createShareLink,
  getSharedFile,
  listShareLinks,
  revokeShareLink,
} from "../shareService.js";

const db = vi.mocked(prisma);
const mockDownloadObject = vi.mocked(downloadObject);

describe("shareService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("createShareLink", () => {
    it("rejects an expiry date in the past", async () => {
      await expect(
        createShareLink({
          fileId: "file-1",
          ownerId: "user-1",
          expiresAt: new Date(Date.now() - 60_000),
        }),
      ).rejects.toMatchObject({ statusCode: 400 });

      expect(db.file.findFirst).not.toHaveBeenCalled();
    });

    it("rejects a file not owned by the user", async () => {
      vi.mocked(db.file.findFirst).mockResolvedValue(null);

      await expect(
        createShareLink({
          fileId: "file-1",
          ownerId: "user-1",
        }),
      ).rejects.toMatchObject({ statusCode: 404 });

      expect(db.shareLink.create).not.toHaveBeenCalled();
    });

    it("creates a share link and stores only the token hash", async () => {
      vi.mocked(db.file.findFirst).mockResolvedValue({
        id: "file-1",
      } as never);

      vi.mocked(db.shareLink.create).mockResolvedValue({
        id: "link-1",
        fileId: "file-1",
        expiresAt: null,
        createdAt: new Date(),
      } as never);

      const result = await createShareLink({
        fileId: "file-1",
        ownerId: "user-1",
      });

      expect(result.id).toBe("link-1");
      expect(result.fileId).toBe("file-1");
      expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(db.shareLink.create).toHaveBeenCalledOnce();

      const createArgs = vi.mocked(db.shareLink.create).mock.calls[0][0];

      expect(createArgs.data.fileId).toBe("file-1");
      expect(createArgs.data.createdById).toBe("user-1");
      expect(createArgs.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(createArgs.data.tokenHash).not.toBe(result.token);
    });
  });

  describe("getSharedFile", () => {
    it("rejects a malformed token without querying the database", async () => {
      await expect(getSharedFile("bad-token")).rejects.toMatchObject({
        statusCode: 404,
      });

      expect(db.shareLink.findUnique).not.toHaveBeenCalled();
      expect(mockDownloadObject).not.toHaveBeenCalled();
    });

    it("rejects a revoked link without downloading the file", async () => {
      const token = "a".repeat(43);

      vi.mocked(db.shareLink.findUnique).mockResolvedValue({
        revokedAt: new Date(),
        expiresAt: null,
        file: {
          id: "file-1",
          originalName: "test.txt",
          mimeType: "text/plain",
          size: BigInt(10),
          storageKey: "user-1/test.txt",
          deletedAt: null,
        },
      } as never);

      await expect(getSharedFile(token)).rejects.toMatchObject({
        statusCode: 404,
      });

      expect(mockDownloadObject).not.toHaveBeenCalled();
    });

    it("rejects an expired link without downloading the file", async () => {
      const token = "b".repeat(43);

      vi.mocked(db.shareLink.findUnique).mockResolvedValue({
        revokedAt: null,
        expiresAt: new Date(Date.now() - 60_000),
        file: {
          id: "file-1",
          originalName: "test.txt",
          mimeType: "text/plain",
          size: BigInt(10),
          storageKey: "user-1/test.txt",
          deletedAt: null,
        },
      } as never);

      await expect(getSharedFile(token)).rejects.toMatchObject({
        statusCode: 404,
      });

      expect(mockDownloadObject).not.toHaveBeenCalled();
    });

    it("rejects a trashed file without downloading it", async () => {
      const token = "c".repeat(43);

      vi.mocked(db.shareLink.findUnique).mockResolvedValue({
        revokedAt: null,
        expiresAt: null,
        file: {
          id: "file-1",
          originalName: "test.txt",
          mimeType: "text/plain",
          size: BigInt(10),
          storageKey: "user-1/test.txt",
          deletedAt: new Date(),
        },
      } as never);

      await expect(getSharedFile(token)).rejects.toMatchObject({
        statusCode: 404,
      });

      expect(mockDownloadObject).not.toHaveBeenCalled();
    });

    it("retrieves a file using a valid share token", async () => {
      const token = "d".repeat(43);
      const fileContent = Buffer.from("Hello from CloudVault");

      vi.mocked(db.shareLink.findUnique).mockResolvedValue({
        revokedAt: null,
        expiresAt: null,
        file: {
          id: "file-1",
          originalName: "test.txt",
          mimeType: "text/plain",
          size: BigInt(fileContent.length),
          storageKey: "user-1/test.txt",
          deletedAt: null,
        },
      } as never);

      mockDownloadObject.mockResolvedValue(fileContent as never);

      const result = await getSharedFile(token);

      expect(db.shareLink.findUnique).toHaveBeenCalledOnce();
      expect(mockDownloadObject).toHaveBeenCalledWith("user-1/test.txt");

      expect(result.file).toMatchObject({
        id: "file-1",
        originalName: "test.txt",
        mimeType: "text/plain",
        size: String(fileContent.length),
      });

      expect(result.object).toEqual(fileContent);
    });
  });

  describe("listShareLinks", () => {
    it("rejects a file not owned by the user", async () => {
      vi.mocked(db.file.findFirst).mockResolvedValue(null);

      await expect(
        listShareLinks({ fileId: "file-1", ownerId: "user-1" }),
      ).rejects.toMatchObject({ statusCode: 404 });

      expect(db.shareLink.findMany).not.toHaveBeenCalled();
    });
  });

  describe("revokeShareLink", () => {
    it("rejects a link that does not belong to the user", async () => {
      vi.mocked(db.shareLink.findFirst).mockResolvedValue(null);

      await expect(
        revokeShareLink({ shareLinkId: "link-1", ownerId: "user-1" }),
      ).rejects.toMatchObject({ statusCode: 404 });

      expect(db.shareLink.update).not.toHaveBeenCalled();
    });

    it("rejects a link that is already revoked", async () => {
      vi.mocked(db.shareLink.findFirst).mockResolvedValue({
        id: "link-1",
        revokedAt: new Date(),
      } as never);

      await expect(
        revokeShareLink({ shareLinkId: "link-1", ownerId: "user-1" }),
      ).rejects.toMatchObject({ statusCode: 400 });

      expect(db.shareLink.update).not.toHaveBeenCalled();
    });
  });
});
