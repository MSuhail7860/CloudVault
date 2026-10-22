import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUniqueUser: vi.fn(),
  createUser: vi.fn(),
  findRefreshToken: vi.fn(),
  createRefreshTokenRecord: vi.fn(),
  updateRefreshTokens: vi.fn(),
  transaction: vi.fn(),
  hashPassword: vi.fn(),
  comparePassword: vi.fn(),
  createAccessToken: vi.fn(),
  createRefreshToken: vi.fn(),
  verifyRefreshToken: vi.fn(),
  hashToken: vi.fn(),
}));

vi.mock("bcrypt", () => ({
  default: {
    hash: mocks.hashPassword,
    compare: mocks.comparePassword,
  },
}));

vi.mock("../../config/database.js", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUniqueUser,
      create: mocks.createUser,
    },
    refreshToken: {
      findUnique: mocks.findRefreshToken,
      create: mocks.createRefreshTokenRecord,
      updateMany: mocks.updateRefreshTokens,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("../../utils/tokenHash.js", () => ({
  hashToken: mocks.hashToken,
}));

vi.mock("../../utils/jwt.js", () => ({
  createAccessToken: mocks.createAccessToken,
  createRefreshToken: mocks.createRefreshToken,
  verifyRefreshToken: mocks.verifyRefreshToken,
}));

import {
  registerUser,
  loginUser,
  refreshUserTokens,
  logoutUser,
} from "../authService.js";

describe("Auth service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Execute the supplied callback against mocked transaction methods.
    mocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          refreshToken: {
            updateMany: mocks.updateRefreshTokens,
            create: mocks.createRefreshTokenRecord,
          },
        })
    );
  });

  describe("registerUser", () => {
    it("normalizes email, hashes the password, and creates a user", async () => {
      const createdUser = {
        id: "user-123",
        email: "suhail@example.com",
        name: "Suhail",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      };

      mocks.findUniqueUser.mockResolvedValue(null);
      mocks.hashPassword.mockResolvedValue("hashed-password");
      mocks.createUser.mockResolvedValue(createdUser);

      const result = await registerUser(
        "  SUHAIL@EXAMPLE.COM  ",
        "StrongPassword123!",
        " Suhail "
      );

      expect(mocks.findUniqueUser).toHaveBeenCalledWith({
        where: { email: "suhail@example.com" },
      });

      expect(mocks.hashPassword).toHaveBeenCalledWith(
        "StrongPassword123!",
        12
      );

      expect(mocks.createUser).toHaveBeenCalledWith({
        data: {
          email: "suhail@example.com",
          passwordHash: "hashed-password",
          name: "Suhail",
        },
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      expect(result).toEqual(createdUser);
    });

    it("rejects an email that already exists", async () => {
      mocks.findUniqueUser.mockResolvedValue({
        id: "existing-user",
      });

      await expect(
        registerUser("user@example.com", "password123")
      ).rejects.toMatchObject({
        message: "User with this email already exists",
        statusCode: 409,
      });

      expect(mocks.hashPassword).not.toHaveBeenCalled();
      expect(mocks.createUser).not.toHaveBeenCalled();
    });

    it("stores a whitespace-only name as undefined", async () => {
      mocks.findUniqueUser.mockResolvedValue(null);
      mocks.hashPassword.mockResolvedValue("hashed-password");
      mocks.createUser.mockResolvedValue({
        id: "user-456",
        email: "user@example.com",
        name: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await registerUser(
        "user@example.com",
        "password123",
        "   "
      );

      expect(mocks.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: undefined,
          }),
        })
      );
    });
  });

  describe("loginUser", () => {
    const existingUser = {
      id: "user-123",
      email: "suhail@example.com",
      name: "Suhail",
      passwordHash: "stored-password-hash",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    it("logs in successfully and stores a hashed refresh token", async () => {
      mocks.findUniqueUser.mockResolvedValue(existingUser);
      mocks.comparePassword.mockResolvedValue(true);
      mocks.createAccessToken.mockResolvedValue("access-token");
      mocks.createRefreshToken.mockResolvedValue("refresh-token");
      mocks.hashToken.mockReturnValue("hashed-refresh-token");
      mocks.createRefreshTokenRecord.mockResolvedValue({
        id: "refresh-record-1",
      });

      const result = await loginUser(
        "  SUHAIL@EXAMPLE.COM ",
        "correct-password"
      );

      expect(mocks.findUniqueUser).toHaveBeenCalledWith({
        where: { email: "suhail@example.com" },
      });

      expect(mocks.comparePassword).toHaveBeenCalledWith(
        "correct-password",
        "stored-password-hash"
      );

      expect(mocks.createAccessToken).toHaveBeenCalledWith(
        "user-123"
      );

      expect(mocks.createRefreshToken).toHaveBeenCalledWith(
        "user-123"
      );

      expect(mocks.hashToken).toHaveBeenCalledWith(
        "refresh-token"
      );

      expect(mocks.createRefreshTokenRecord).toHaveBeenCalledWith({
        data: {
          tokenHash: "hashed-refresh-token",
          userId: "user-123",
          expiresAt: expect.any(Date),
        },
      });

      expect(result).toEqual({
        user: {
          id: "user-123",
          email: "suhail@example.com",
          name: "Suhail",
          createdAt: existingUser.createdAt,
          updatedAt: existingUser.updatedAt,
        },
        accessToken: "access-token",
        refreshToken: "refresh-token",
      });

      expect(result.user).not.toHaveProperty("passwordHash");
    });

    it("rejects login when the email does not exist", async () => {
      mocks.findUniqueUser.mockResolvedValue(null);

      await expect(
        loginUser("unknown@example.com", "password123")
      ).rejects.toMatchObject({
        message: "Invalid email or password",
        statusCode: 401,
      });

      expect(mocks.comparePassword).not.toHaveBeenCalled();
      expect(mocks.createAccessToken).not.toHaveBeenCalled();
      expect(mocks.createRefreshToken).not.toHaveBeenCalled();
    });

    it("rejects login when the password is incorrect", async () => {
      mocks.findUniqueUser.mockResolvedValue(existingUser);
      mocks.comparePassword.mockResolvedValue(false);

      await expect(
        loginUser("suhail@example.com", "wrong-password")
      ).rejects.toMatchObject({
        message: "Invalid email or password",
        statusCode: 401,
      });

      expect(mocks.createAccessToken).not.toHaveBeenCalled();
      expect(mocks.createRefreshToken).not.toHaveBeenCalled();
      expect(mocks.createRefreshTokenRecord).not.toHaveBeenCalled();
    });
  });

  describe("refreshUserTokens", () => {
    const storedToken = {
      id: "refresh-record-1",
      userId: "user-123",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };

    const prepareValidRefresh = () => {
      mocks.verifyRefreshToken.mockResolvedValue({
        userId: "user-123",
      });
      mocks.hashToken
        .mockReturnValueOnce("old-token-hash")
        .mockReturnValueOnce("new-token-hash");
      mocks.findRefreshToken.mockResolvedValue(storedToken);
      mocks.createAccessToken.mockResolvedValue("new-access-token");
      mocks.createRefreshToken.mockResolvedValue("new-refresh-token");
      mocks.updateRefreshTokens.mockResolvedValue({ count: 1 });
      mocks.createRefreshTokenRecord.mockResolvedValue({
        id: "new-refresh-record",
      });
    };

    it("rotates a valid refresh token and stores its replacement", async () => {
      prepareValidRefresh();

      const result = await refreshUserTokens("old-refresh-token");

      expect(mocks.verifyRefreshToken).toHaveBeenCalledWith(
        "old-refresh-token"
      );
      expect(mocks.hashToken).toHaveBeenCalledWith(
        "old-refresh-token"
      );
      expect(mocks.findRefreshToken).toHaveBeenCalledWith({
        where: { tokenHash: "old-token-hash" },
      });
      expect(mocks.createAccessToken).toHaveBeenCalledWith(
        "user-123"
      );
      expect(mocks.createRefreshToken).toHaveBeenCalledWith(
        "user-123"
      );

      expect(mocks.transaction).toHaveBeenCalledOnce();
      expect(mocks.updateRefreshTokens).toHaveBeenCalledWith({
        where: {
          id: "refresh-record-1",
          userId: "user-123",
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { revokedAt: expect.any(Date) },
      });

      expect(mocks.createRefreshTokenRecord).toHaveBeenCalledWith({
        data: {
          tokenHash: "new-token-hash",
          userId: "user-123",
          expiresAt: expect.any(Date),
        },
      });

      expect(result).toEqual({
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
      });
    });

    it("rejects a refresh token that fails JWT verification", async () => {
      mocks.verifyRefreshToken.mockRejectedValue(
        new Error("Invalid token")
      );

      await expect(
        refreshUserTokens("invalid-token")
      ).rejects.toMatchObject({
        message: "Invalid or expired refresh token",
        statusCode: 401,
      });

      expect(mocks.findRefreshToken).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("rejects a refresh token missing from the database", async () => {
      mocks.verifyRefreshToken.mockResolvedValue({
        userId: "user-123",
      });
      mocks.hashToken.mockReturnValue("unknown-token-hash");
      mocks.findRefreshToken.mockResolvedValue(null);

      await expect(
        refreshUserTokens("unknown-token")
      ).rejects.toMatchObject({
        message: "Invalid or expired refresh token",
        statusCode: 401,
      });

      expect(mocks.createAccessToken).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it.each([
      {
        caseName: "belongs to a different user",
        token: {
          ...storedToken,
          userId: "another-user",
        },
      },
      {
        caseName: "has already been revoked",
        token: {
          ...storedToken,
          revokedAt: new Date(),
        },
      },
      {
        caseName: "has expired",
        token: {
          ...storedToken,
          expiresAt: new Date(Date.now() - 60_000),
        },
      },
    ])("rejects a stored refresh token that $caseName", async ({
      token,
    }) => {
      mocks.verifyRefreshToken.mockResolvedValue({
        userId: "user-123",
      });
      mocks.hashToken.mockReturnValue("old-token-hash");
      mocks.findRefreshToken.mockResolvedValue(token);

      await expect(
        refreshUserTokens("old-refresh-token")
      ).rejects.toMatchObject({
        message: "Invalid or expired refresh token",
        statusCode: 401,
      });

      expect(mocks.createAccessToken).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("rejects rotation if another request already revoked the token", async () => {
      prepareValidRefresh();
      mocks.updateRefreshTokens.mockResolvedValue({ count: 0 });

      await expect(
        refreshUserTokens("old-refresh-token")
      ).rejects.toMatchObject({
        message: "Invalid or expired refresh token",
        statusCode: 401,
      });

      expect(mocks.transaction).toHaveBeenCalledOnce();
      expect(mocks.createRefreshTokenRecord).not.toHaveBeenCalled();
    });
  });

  describe("logoutUser", () => {
    it("revokes a valid refresh token", async () => {
      mocks.verifyRefreshToken.mockResolvedValue({
        userId: "user-123",
      });
      mocks.hashToken.mockReturnValue("stored-token-hash");
      mocks.updateRefreshTokens.mockResolvedValue({ count: 1 });

      const result = await logoutUser("valid-refresh-token");

      expect(mocks.verifyRefreshToken).toHaveBeenCalledWith(
        "valid-refresh-token"
      );
      expect(mocks.hashToken).toHaveBeenCalledWith(
        "valid-refresh-token"
      );
      expect(mocks.updateRefreshTokens).toHaveBeenCalledWith({
        where: {
          tokenHash: "stored-token-hash",
          userId: "user-123",
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { revokedAt: expect.any(Date) },
      });

      expect(result).toEqual({
        message: "Logged out successfully",
      });
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("rejects logout when JWT verification fails", async () => {
      mocks.verifyRefreshToken.mockRejectedValue(
        new Error("Invalid token")
      );

      await expect(
        logoutUser("invalid-refresh-token")
      ).rejects.toMatchObject({
        message: "Invalid or expired refresh token",
        statusCode: 401,
      });

      expect(mocks.updateRefreshTokens).not.toHaveBeenCalled();
    });

    it("rejects logout when the token is missing, expired, or revoked", async () => {
      mocks.verifyRefreshToken.mockResolvedValue({
        userId: "user-123",
      });
      mocks.hashToken.mockReturnValue("stored-token-hash");
      mocks.updateRefreshTokens.mockResolvedValue({ count: 0 });

      await expect(
        logoutUser("already-revoked-token")
      ).rejects.toMatchObject({
        message: "Invalid or expired refresh token",
        statusCode: 401,
      });
    });
  });
});

