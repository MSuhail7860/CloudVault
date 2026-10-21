import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUniqueUser: vi.fn(),
  createUser: vi.fn(),
  createRefreshTokenRecord: vi.fn(),
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

// Mock the database so these tests never access the real database.
vi.mock("../../config/database.js", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUniqueUser,
      create: mocks.createUser,
    },
    refreshToken: {
      create: mocks.createRefreshTokenRecord,
    },
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

import { registerUser, loginUser } from "../authService.js";

describe("Auth service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("registerUser", () => {
    it("normalizes the email, hashes the password, and creates a user", async () => {
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
});

