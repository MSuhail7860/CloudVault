import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/database.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    file: {
      findFirst: vi.fn(),
    },
    shareLink: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
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
  getSharedFileForUser,
  listShareLinks,
  listSharesCreatedByMe,
  listSharesWithMe,
  updateSharePermission,
  revokeShareLink,
} from "../shareService.js";

const db = vi.mocked(prisma);
const mockDownloadObject = vi.mocked(downloadObject);

describe("shareService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.$executeRaw).mockResolvedValue(1 as never);
    vi.mocked(db.$transaction).mockImplementation(
      (async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback(db as never)) as never,
    );
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
      vi.mocked(db.user.findUnique).mockResolvedValue({
        email: "owner@example.com",
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

    it("normalizes recipient email before storing the share", async () => {
      vi.mocked(db.file.findFirst).mockResolvedValue({
        id: "file-1",
        name: "report.pdf",
      } as never);
      vi.mocked(db.user.findUnique)
        .mockResolvedValueOnce({ email: "owner@example.com" } as never)
        .mockResolvedValueOnce({
          id: "user-2",
          emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
          accountStatus: "ACTIVE",
        } as never);
      vi.mocked(db.shareLink.create).mockResolvedValue({
        id: "link-1",
        fileId: "file-1",
        expiresAt: null,
        createdAt: new Date(),
      } as never);

      await createShareLink({
        fileId: "file-1",
        ownerId: "user-1",
        sharedWithEmail: "  RECIPIENT@Example.COM ",
      });

      expect(db.shareLink.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sharedWithEmail: "recipient@example.com",
            sharedWithId: "user-2",
          }),
        }),
      );
    });

    it("rejects restricted shares for unverified registered recipients", async () => {
      vi.mocked(db.file.findFirst).mockResolvedValue({
        id: "file-1",
        name: "report.pdf",
      } as never);
      vi.mocked(db.user.findUnique)
        .mockResolvedValueOnce({ email: "owner@example.com" } as never)
        .mockResolvedValueOnce({
          id: "unverified-recipient",
          emailVerifiedAt: null,
        } as never);

      await expect(
        createShareLink({
          fileId: "file-1",
          ownerId: "user-1",
          sharedWithEmail: "new-recipient@example.com",
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: "A verified recipient account is required for restricted sharing",
      });

      expect(db.shareLink.create).not.toHaveBeenCalled();
    });

    it("rejects restricted shares for unregistered recipients", async () => {
      vi.mocked(db.file.findFirst).mockResolvedValue({
        id: "file-1",
        name: "report.pdf",
      } as never);
      vi.mocked(db.user.findUnique)
        .mockResolvedValueOnce({ email: "owner@example.com" } as never)
        .mockResolvedValueOnce(null);

      await expect(
        createShareLink({
          fileId: "file-1",
          ownerId: "user-1",
          sharedWithEmail: "new-recipient@example.com",
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: "A verified recipient account is required for restricted sharing",
      });

      expect(db.shareLink.create).not.toHaveBeenCalled();
    });

    it("creates restricted shares for verified registered recipients", async () => {
      const emailVerifiedAt = new Date("2026-01-01T00:00:00.000Z");
      vi.mocked(db.file.findFirst).mockResolvedValue({
        id: "file-1",
        name: "report.pdf",
      } as never);
      vi.mocked(db.user.findUnique)
        .mockResolvedValueOnce({ email: "owner@example.com" } as never)
        .mockResolvedValueOnce({
          id: "verified-recipient",
          emailVerifiedAt,
          accountStatus: "ACTIVE",
        } as never);
      vi.mocked(db.shareLink.create).mockResolvedValue({
        id: "link-verified",
        fileId: "file-1",
        expiresAt: null,
        createdAt: new Date(),
      } as never);

      await createShareLink({
        fileId: "file-1",
        ownerId: "user-1",
        sharedWithEmail: "verified@example.com",
      });

      expect(db.shareLink.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sharedWithId: "verified-recipient",
            sharedWithEmail: "verified@example.com",
          }),
        }),
      );
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
        sharedWithId: null,
        sharedWithEmail: null,
        file: {
          id: "file-1",
          originalName: "test.txt",
          mimeType: "text/plain",
          size: BigInt(10),
          storageKey: "user-1/test.txt",
          deletedAt: null,
          owner: { accountStatus: "ACTIVE" },
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
        sharedWithId: null,
        sharedWithEmail: null,
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

    it("rejects recipient-restricted links on the public download route", async () => {
      const token = "d".repeat(43);

      vi.mocked(db.shareLink.findUnique).mockResolvedValue({
        revokedAt: null,
        expiresAt: null,
        sharedWithId: "recipient-1",
        sharedWithEmail: "recipient@example.com",
        file: {
          id: "file-1",
          name: "test.txt",
          originalName: "test.txt",
          mimeType: "text/plain",
          size: BigInt(10),
          storageKey: "user-1/test.txt",
          deletedAt: null,
          owner: { accountStatus: "ACTIVE" },
        },
      } as never);

      await expect(getSharedFile(token)).rejects.toMatchObject({
        statusCode: 404,
        message: "Share link is invalid or unavailable",
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
          owner: { accountStatus: "ACTIVE" },
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

    it("rejects public access when the file owner is pending deletion", async () => {
      const token = "e".repeat(43);

      vi.mocked(db.shareLink.findUnique).mockResolvedValue({
        revokedAt: null,
        expiresAt: null,
        file: {
          id: "file-1",
          originalName: "test.txt",
          mimeType: "text/plain",
          size: BigInt(10),
          storageKey: "user-1/test.txt",
          deletedAt: null,
          owner: { accountStatus: "PENDING_DELETION" },
        },
      } as never);

      await expect(getSharedFile(token)).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(mockDownloadObject).not.toHaveBeenCalled();
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

    it("lists share links for an active file owned by the user", async () => {
      const createdAt = new Date("2026-10-20T10:00:00.000Z");
      const expiresAt = new Date("2026-11-20T10:00:00.000Z");

      const links = [
        {
          id: "link-1",
          fileId: "file-1",
          expiresAt,
          revokedAt: null,
          createdAt,
        },
      ];

      vi.mocked(db.file.findFirst).mockResolvedValue({
        id: "file-1",
      } as never);

      vi.mocked(db.shareLink.findMany).mockResolvedValue(links as never);

      const result = await listShareLinks({
        fileId: "file-1",
        ownerId: "user-1",
      });

      expect(db.file.findFirst).toHaveBeenCalledWith({
        where: {
          id: "file-1",
          ownerId: "user-1",
          deletedAt: null,
        },
        select: { id: true },
      });

      expect(db.shareLink.findMany).toHaveBeenCalledWith({
        where: { fileId: "file-1" },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          fileId: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
        },
      });

      expect(result).toEqual(links);
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

    it("revokes a valid share link owned by the user", async () => {
      const revokedAt = new Date("2026-10-21T10:00:00.000Z");

      vi.mocked(db.shareLink.findFirst).mockResolvedValue({
        id: "link-1",
        revokedAt: null,
      } as never);

      vi.mocked(db.shareLink.update).mockResolvedValue({
        id: "link-1",
        revokedAt,
      } as never);

      const result = await revokeShareLink({
        shareLinkId: "link-1",
        ownerId: "user-1",
      });

      expect(db.shareLink.findFirst).toHaveBeenCalledWith({
        where: {
          id: "link-1",
          createdById: "user-1",
          file: { ownerId: "user-1" },
        },
        select: { id: true, revokedAt: true },
      });

      expect(db.shareLink.update).toHaveBeenCalledOnce();
      expect(db.shareLink.update).toHaveBeenCalledWith({
        where: { id: "link-1" },
        data: { revokedAt: expect.any(Date) },
        select: { id: true, revokedAt: true },
      });

      expect(result).toEqual({
        id: "link-1",
        revokedAt,
      });
    });
  });

  describe("listSharesCreatedByMe", () => {
    it("returns all active shares created by the user", async () => {
      vi.mocked(db.shareLink.findMany).mockResolvedValue([
        {
          id: "link-1",
          fileId: "file-1",
          permission: "VIEW",
          sharedWithEmail: "bob@example.com",
          expiresAt: null,
          revokedAt: null,
          createdAt: new Date(),
          file: {
            id: "file-1",
            name: "report.pdf",
            originalName: "report.pdf",
            mimeType: "application/pdf",
            size: 2048n,
          },
          sharedWith: null,
        },
      ] as never);

      const shares = await listSharesCreatedByMe("user-1");

      expect(shares).toHaveLength(1);
      expect(shares[0].file.size).toBe("2048");
      expect(shares[0].permission).toBe("VIEW");
    });
  });

  describe("listSharesWithMe", () => {
    it("returns active shares targeted to the user", async () => {
      vi.mocked(db.shareLink.findMany).mockResolvedValue([
        {
          id: "link-2",
          fileId: "file-2",
          permission: "EDIT",
          expiresAt: null,
          createdAt: new Date(),
          file: {
            id: "file-2",
            name: "shared-doc.txt",
            originalName: "shared-doc.txt",
            mimeType: "text/plain",
            size: 1024n,
            owner: { id: "user-2", name: "Bob", email: "bob@example.com" },
          },
        },
      ] as never);

      const shares = await listSharesWithMe({
        userId: "user-1",
      });

      expect(shares).toHaveLength(1);
      expect(shares[0].permission).toBe("EDIT");
      expect(shares[0].file.owner.email).toBe("bob@example.com");
      expect(db.shareLink.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sharedWithId: "user-1",
            sharedWith: {
              is: {
                emailVerifiedAt: { not: null },
                accountStatus: "ACTIVE",
              },
            },
            file: {
              deletedAt: null,
              owner: { accountStatus: "ACTIVE" },
            },
          }),
        }),
      );
    });

    it("does not list legacy email-only shares or shares for another recipient", async () => {
      vi.mocked(db.shareLink.findMany).mockResolvedValue([] as never);

      const shares = await listSharesWithMe({ userId: "attacker-user" });

      expect(shares).toEqual([]);
      expect(db.shareLink.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sharedWithId: "attacker-user",
            sharedWith: {
              is: {
                emailVerifiedAt: { not: null },
                accountStatus: "ACTIVE",
              },
            },
          }),
        }),
      );
    });
  });

  describe("getSharedFileForUser", () => {
    it("denies a wrong authenticated recipient and legacy email-only share", async () => {
      vi.mocked(db.shareLink.findFirst).mockResolvedValue(null);

      await expect(
        getSharedFileForUser({
          shareId: "link-1",
          userId: "attacker-user",
        }),
      ).rejects.toMatchObject({
        statusCode: 404,
        message: "Shared file not found or access has expired",
      });

      expect(db.shareLink.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "link-1",
            sharedWithId: "attacker-user",
            sharedWith: {
              is: {
                emailVerifiedAt: { not: null },
                accountStatus: "ACTIVE",
              },
            },
          }),
        }),
      );
      expect(mockDownloadObject).not.toHaveBeenCalled();
    });

    it("allows the verified recipient to download the restricted share", async () => {
      const object = { Body: Buffer.from("shared file") };
      vi.mocked(db.shareLink.findFirst).mockResolvedValue({
        id: "link-1",
        permission: "VIEW",
        file: {
          id: "file-1",
          name: "shared.txt",
          originalName: "shared.txt",
          mimeType: "text/plain",
          size: BigInt(11),
          storageKey: "owner/storage-key",
        },
      } as never);
      mockDownloadObject.mockResolvedValue(object as never);

      const result = await getSharedFileForUser({
        shareId: "link-1",
        userId: "verified-recipient",
      });

      expect(db.shareLink.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "link-1",
            sharedWithId: "verified-recipient",
            sharedWith: {
              is: {
                emailVerifiedAt: { not: null },
                accountStatus: "ACTIVE",
              },
            },
          }),
        }),
      );
      expect(mockDownloadObject).toHaveBeenCalledWith("owner/storage-key");
      expect(result.file.size).toBe("11");
    });
  });

  describe("updateSharePermission", () => {
    it("updates permission and logs activity", async () => {
      vi.mocked(db.shareLink.findFirst).mockResolvedValue({
        id: "link-1",
        permission: "VIEW",
        expiresAt: null,
        file: { id: "file-1", name: "report.pdf" },
      } as never);

      vi.mocked(db.shareLink.update).mockResolvedValue({
        id: "link-1",
        fileId: "file-1",
        permission: "EDIT",
        expiresAt: null,
        revokedAt: null,
        updatedAt: new Date(),
      } as never);

      const updated = await updateSharePermission({
        shareLinkId: "link-1",
        ownerId: "user-1",
        permission: "EDIT",
      });

      expect(updated.permission).toBe("EDIT");
      expect(db.shareLink.update).toHaveBeenCalledWith({
        where: { id: "link-1" },
        data: { permission: "EDIT" },
        select: expect.any(Object),
      });
    });
  });
});
