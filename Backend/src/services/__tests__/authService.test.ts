import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUniqueUser: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
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
  executeRaw: vi.fn(),
  findEmailVerificationToken: vi.fn(),
  upsertEmailVerificationToken: vi.fn(),
  updateEmailVerificationToken: vi.fn(),
  emailVerificationMessage: vi.fn(),
  updateUserMany: vi.fn(),
}));

vi.mock("bcrypt", () => ({
  default: {
    hash: mocks.hashPassword,
    compare: mocks.comparePassword,
  },
}));

vi.mock("../emailService.js", () => ({
  sendVerificationEmail: mocks.emailVerificationMessage,
}));

vi.mock("../../config/database.js", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUniqueUser,
      create: mocks.createUser,
      update: mocks.updateUser,
      updateMany: mocks.updateUserMany,
    },
    refreshToken: {
      findUnique: mocks.findRefreshToken,
      create: mocks.createRefreshTokenRecord,
      updateMany: mocks.updateRefreshTokens,
    },
    $transaction: mocks.transaction,
    $executeRaw: mocks.executeRaw,
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
  updateUserProfile,
  changeUserPassword,
  refreshUserTokens,
  logoutUser,
  resendEmailVerification,
  verifyEmailAddress,
} from "../authService.js";

describe("Auth service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hashToken.mockReset();
    mocks.findUniqueUser.mockResolvedValue({
      accountStatus: "ACTIVE",
      sessionVersion: 0,
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    mocks.executeRaw.mockResolvedValue(1);
    mocks.findEmailVerificationToken.mockResolvedValue(null);
    mocks.upsertEmailVerificationToken.mockResolvedValue({});
    mocks.updateEmailVerificationToken.mockResolvedValue({ count: 1 });
    mocks.emailVerificationMessage.mockResolvedValue(undefined);

    // Execute the supplied callback against mocked transaction methods.
    mocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          user: {
            update: mocks.updateUser,
            findUnique: mocks.findUniqueUser,
            updateMany: mocks.updateUserMany,
          },
          emailVerificationToken: {
            findUnique: mocks.findEmailVerificationToken,
            upsert: mocks.upsertEmailVerificationToken,
            updateMany: mocks.updateEmailVerificationToken,
          },
          refreshToken: {
            updateMany: mocks.updateRefreshTokens,
            create: mocks.createRefreshTokenRecord,
          },
          $executeRaw: mocks.executeRaw,
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
        select: { id: true },
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
          emailVerifiedAt: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      expect(mocks.createUser.mock.calls[0]?.[0].data).not.toHaveProperty(
        "emailVerifiedAt",
      );
      expect(result).toEqual(createdUser);
    });

    it("keeps duplicate registration generic and attempts a cooldown-governed resend", async () => {
      mocks.findUniqueUser
        .mockResolvedValueOnce({ id: "existing-user" })
        .mockResolvedValueOnce({
          email: "user@example.com",
          emailVerifiedAt: null,
        });
      mocks.hashToken.mockReturnValue("new-verification-hash");

      await expect(
        registerUser("user@example.com", "password123"),
      ).resolves.toBeNull();

      expect(mocks.emailVerificationMessage).toHaveBeenCalledOnce();
      expect(mocks.createUser).not.toHaveBeenCalled();
      expect(mocks.hashPassword).toHaveBeenCalledWith("password123", 12);
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

    it("stores only a token hash and sends the raw token through the email adapter", async () => {
      mocks.findUniqueUser
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          email: "user@example.com",
          emailVerifiedAt: null,
        });
      mocks.hashPassword.mockResolvedValue("hashed-password");
      mocks.hashToken.mockReturnValue("hashed-verification-token");
      mocks.createUser.mockResolvedValue({
        id: "user-456",
        email: "user@example.com",
        emailVerifiedAt: null,
        name: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await registerUser("user@example.com", "password123");

      expect(mocks.upsertEmailVerificationToken).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-456" },
          create: expect.objectContaining({
            tokenHash: "hashed-verification-token",
            expiresAt: expect.any(Date),
          }),
        }),
      );
      const [email, token] = mocks.emailVerificationMessage.mock.calls[0]!;
      expect(email).toBe("user@example.com");
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(token).not.toBe("hashed-verification-token");
    });

    it("keeps the account recoverable when verification delivery fails", async () => {
      mocks.findUniqueUser
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          email: "user@example.com",
          emailVerifiedAt: null,
        });
      mocks.hashPassword.mockResolvedValue("hashed-password");
      mocks.hashToken.mockReturnValue("stored-verification-hash");
      mocks.createUser.mockResolvedValue({
        id: "user-456",
        email: "user@example.com",
        emailVerifiedAt: null,
        name: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mocks.emailVerificationMessage.mockRejectedValueOnce(
        new Error("provider response contained sensitive data"),
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        registerUser("user@example.com", "password123"),
      ).resolves.toMatchObject({ id: "user-456" });

      expect(mocks.upsertEmailVerificationToken).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls.flat().join(" ")).not.toContain(
        "provider response contained sensitive data",
      );
      errorSpy.mockRestore();
    });

    it("sends a generic resend request only when an eligible account needs verification", async () => {
      mocks.findUniqueUser.mockResolvedValueOnce(null);
      await expect(
        resendEmailVerification("missing@example.com"),
      ).resolves.toBeUndefined();
      expect(mocks.emailVerificationMessage).not.toHaveBeenCalled();

      const eligibleUser = {
        id: "user-456",
        accountStatus: "ACTIVE",
        emailVerifiedAt: null,
        email: "user@example.com",
      };
      mocks.findUniqueUser
        .mockResolvedValueOnce(eligibleUser)
        .mockResolvedValueOnce(eligibleUser);
      mocks.hashToken.mockReturnValue("replacement-token-hash");
      await resendEmailVerification(" USER@example.com ");
      expect(mocks.upsertEmailVerificationToken).toHaveBeenCalled();
      expect(mocks.emailVerificationMessage).toHaveBeenCalledOnce();
    });

    it("enforces the resend cooldown without replacing the outstanding token", async () => {
      mocks.findUniqueUser.mockResolvedValue({
        id: "user-456",
        accountStatus: "ACTIVE",
        emailVerifiedAt: null,
        email: "user@example.com",
      });
      mocks.findEmailVerificationToken.mockResolvedValue({
        createdAt: new Date(),
      });

      await resendEmailVerification("user@example.com");

      expect(mocks.upsertEmailVerificationToken).not.toHaveBeenCalled();
      expect(mocks.emailVerificationMessage).not.toHaveBeenCalled();
    });

    it("consumes verification tokens atomically and sets a password only after email ownership is proven", async () => {
      mocks.hashToken.mockReturnValue("stored-verification-hash");
      mocks.findEmailVerificationToken.mockResolvedValue({
        userId: "user-456",
      });
      mocks.updateEmailVerificationToken.mockResolvedValue({ count: 1 });
      mocks.updateUserMany.mockResolvedValue({ count: 1 });

      mocks.hashPassword.mockResolvedValue("verified-password-hash");
      await expect(
        verifyEmailAddress("A".repeat(43), "owner-chosen-password"),
      ).resolves.toBeUndefined();

      expect(mocks.hashPassword).toHaveBeenCalledWith(
        "owner-chosen-password",
        12,
      );

      expect(mocks.updateEmailVerificationToken).toHaveBeenCalledWith({
        where: {
          tokenHash: "stored-verification-hash",
          consumedAt: null,
          expiresAt: { gt: expect.any(Date) },
          user: { accountStatus: "ACTIVE", emailVerifiedAt: null },
        },
        data: { consumedAt: expect.any(Date) },
      });
      expect(mocks.updateUserMany).toHaveBeenCalledWith({
        where: {
          id: "user-456",
          accountStatus: "ACTIVE",
          emailVerifiedAt: null,
        },
        data: {
          emailVerifiedAt: expect.any(Date),
          passwordHash: "verified-password-hash",
          sessionVersion: { increment: 1 },
        },
      });
      expect(mocks.updateRefreshTokens).toHaveBeenCalledWith({
        where: { userId: "user-456", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("rejects malformed or already-consumed verification tokens", async () => {
      await expect(
        verifyEmailAddress("bad-token", "strong-password"),
      ).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(mocks.transaction).not.toHaveBeenCalled();

      mocks.hashToken.mockReturnValue("consumed-token-hash");
      mocks.updateEmailVerificationToken.mockResolvedValue({ count: 0 });
      await expect(
        verifyEmailAddress("A".repeat(43), "strong-password"),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: "Verification link is invalid or expired",
      });
    });

    it("rejects a short password before consuming the verification token", async () => {
      await expect(
        verifyEmailAddress("A".repeat(43), "short"),
      ).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.hashPassword).not.toHaveBeenCalled();
    });
  });

  describe("loginUser", () => {
    const existingUser = {
      id: "user-123",
      email: "suhail@example.com",
      name: "Suhail",
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      sessionVersion: 0,
      accountStatus: "ACTIVE",
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
        "user-123",
        0,
      );

      expect(mocks.createRefreshToken).toHaveBeenCalledWith(
        "user-123",
        0,
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
          emailVerifiedAt: existingUser.emailVerifiedAt,
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

    it("does not authenticate an unverified account even when its password matches", async () => {
      mocks.findUniqueUser.mockResolvedValue({
        ...existingUser,
        emailVerifiedAt: null,
      });
      mocks.comparePassword.mockResolvedValue(true);

      await expect(
        loginUser("suhail@example.com", "correct-password"),
      ).rejects.toMatchObject({
        statusCode: 401,
        message: "Invalid email or password",
      });
      expect(mocks.createAccessToken).not.toHaveBeenCalled();
      expect(mocks.createRefreshToken).not.toHaveBeenCalled();
      expect(mocks.createRefreshTokenRecord).not.toHaveBeenCalled();
    });

    it("does not authenticate an unverified account even when its password matches", async () => {
      mocks.findUniqueUser.mockResolvedValue({
        ...existingUser,
        emailVerifiedAt: null,
      });
      mocks.comparePassword.mockResolvedValue(true);

      await expect(
        loginUser("suhail@example.com", "correct-password"),
      ).rejects.toMatchObject({
        statusCode: 401,
        message: "Invalid email or password",
      });
      expect(mocks.createAccessToken).not.toHaveBeenCalled();
      expect(mocks.createRefreshToken).not.toHaveBeenCalled();
      expect(mocks.createRefreshTokenRecord).not.toHaveBeenCalled();
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

    it("rejects login for an account pending deletion", async () => {
      mocks.findUniqueUser.mockResolvedValue({
        ...existingUser,
        accountStatus: "PENDING_DELETION",
      });

      await expect(
        loginUser("suhail@example.com", "correct-password"),
      ).rejects.toMatchObject({
        message: "Invalid email or password",
        statusCode: 401,
      });

      expect(mocks.comparePassword).not.toHaveBeenCalled();
      expect(mocks.createRefreshTokenRecord).not.toHaveBeenCalled();
    });
  });

  describe("updateUserProfile", () => {
    const updatedUser = {
      id: "user-123",
      email: "suhail@example.com",
      name: "New Display Name",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    };

    it("trims and updates the authenticated user's name", async () => {
      mocks.findUniqueUser.mockResolvedValue({ id: "user-123" });
      mocks.updateUser.mockResolvedValue(updatedUser);

      const result = await updateUserProfile(
        "user-123",
        "  New Display Name  ",
      );

      expect(mocks.updateUser).toHaveBeenCalledWith({
        where: { id: "user-123" },
        data: { name: "New Display Name" },
        select: {
          id: true,
          email: true,
          emailVerifiedAt: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      expect(result).toEqual(updatedUser);
      expect(result).not.toHaveProperty("passwordHash");
    });

    it("rejects an empty name", async () => {
      await expect(updateUserProfile("user-123", "   ")).rejects.toMatchObject({
        message: "Name cannot be empty",
        statusCode: 400,
      });

      expect(mocks.findUniqueUser).not.toHaveBeenCalled();
      expect(mocks.updateUser).not.toHaveBeenCalled();
    });

    it("rejects a name longer than 100 characters", async () => {
      await expect(
        updateUserProfile("user-123", "a".repeat(101)),
      ).rejects.toMatchObject({
        message: "Name cannot exceed 100 characters",
        statusCode: 400,
      });

      expect(mocks.findUniqueUser).not.toHaveBeenCalled();
      expect(mocks.updateUser).not.toHaveBeenCalled();
    });

    it("propagates unexpected database errors", async () => {
      const databaseError = new Error("Database unavailable");
      mocks.transaction.mockRejectedValue(databaseError);

      await expect(
        updateUserProfile("user-123", "New Display Name"),
      ).rejects.toBe(databaseError);
    });
  });

  describe("changeUserPassword", () => {
    const existingUser = {
      id: "user-123",
      passwordHash: "current-password-hash",
    };

    const prepareValidPasswordChange = () => {
      mocks.findUniqueUser.mockResolvedValue(existingUser);
      mocks.comparePassword.mockResolvedValue(true);
      mocks.hashPassword.mockResolvedValue("new-password-hash");
      mocks.updateUser.mockResolvedValue({ id: "user-123" });
      mocks.updateRefreshTokens.mockResolvedValue({ count: 2 });
    };

    it("changes the password and revokes active refresh tokens", async () => {
      prepareValidPasswordChange();

      await changeUserPassword({
        userId: "user-123",
        currentPassword: "current-password",
        newPassword: "new-password",
      });

      expect(mocks.findUniqueUser).toHaveBeenCalledWith({
        where: { id: "user-123" },
        select: {
          id: true,
          passwordHash: true,
        },
      });
      expect(mocks.comparePassword).toHaveBeenCalledWith(
        "current-password",
        "current-password-hash",
      );
      expect(mocks.hashPassword).toHaveBeenCalledWith(
        "new-password",
        12,
      );
      expect(mocks.transaction).toHaveBeenCalledOnce();
      expect(mocks.updateUser).toHaveBeenCalledWith({
        where: { id: "user-123" },
        data: {
          passwordHash: "new-password-hash",
          sessionVersion: { increment: 1 },
        },
      });
      expect(mocks.updateRefreshTokens).toHaveBeenCalledWith({
        where: {
          userId: "user-123",
          revokedAt: null,
        },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("rejects an incorrect current password", async () => {
      mocks.findUniqueUser.mockResolvedValue(existingUser);
      mocks.comparePassword.mockResolvedValue(false);

      await expect(
        changeUserPassword({
          userId: "user-123",
          currentPassword: "wrong-password",
          newPassword: "new-password",
        }),
      ).rejects.toMatchObject({
        message: "Current password is incorrect",
        statusCode: 401,
      });

      expect(mocks.hashPassword).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("rejects a new password shorter than 8 characters", async () => {
      await expect(
        changeUserPassword({
          userId: "user-123",
          currentPassword: "current-password",
          newPassword: "short",
        }),
      ).rejects.toMatchObject({
        message: "New password must contain at least 8 characters",
        statusCode: 400,
      });

      expect(mocks.findUniqueUser).not.toHaveBeenCalled();
      expect(mocks.comparePassword).not.toHaveBeenCalled();
    });

    it("rejects a new password longer than bcrypt's 72-byte limit", async () => {
      await expect(
        changeUserPassword({
          userId: "user-123",
          currentPassword: "current-password",
          newPassword: "a".repeat(73),
        }),
      ).rejects.toMatchObject({
        message: "New password cannot exceed 72 bytes",
        statusCode: 400,
      });

      expect(mocks.findUniqueUser).not.toHaveBeenCalled();
      expect(mocks.comparePassword).not.toHaveBeenCalled();
    });

    it("applies the password limit to UTF-8 byte length", async () => {
      await expect(
        changeUserPassword({
          userId: "user-123",
          currentPassword: "current-password",
          newPassword: "😀".repeat(19),
        }),
      ).rejects.toMatchObject({
        message: "New password cannot exceed 72 bytes",
        statusCode: 400,
      });

      expect(mocks.findUniqueUser).not.toHaveBeenCalled();
    });

    it("rejects a new password identical to the current password", async () => {
      mocks.findUniqueUser.mockResolvedValue(existingUser);
      mocks.comparePassword.mockResolvedValue(true);

      await expect(
        changeUserPassword({
          userId: "user-123",
          currentPassword: "same-password",
          newPassword: "same-password",
        }),
      ).rejects.toMatchObject({
        message: "New password must be different from the current password",
        statusCode: 400,
      });

      expect(mocks.hashPassword).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("propagates unexpected database errors", async () => {
      const databaseError = new Error("Database unavailable");
      mocks.findUniqueUser.mockRejectedValue(databaseError);

      await expect(
        changeUserPassword({
          userId: "user-123",
          currentPassword: "current-password",
          newPassword: "new-password",
        }),
      ).rejects.toBe(databaseError);
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
        sessionVersion: 0,
      });
      mocks.hashToken
        .mockReturnValueOnce("old-token-hash")
        .mockReturnValueOnce("new-token-hash");
      mocks.findRefreshToken.mockResolvedValue(storedToken);
      mocks.createAccessToken.mockResolvedValue("new-access-token");
      mocks.createRefreshToken.mockResolvedValue("new-refresh-token");
      mocks.findUniqueUser.mockResolvedValue({
        accountStatus: "ACTIVE",
        sessionVersion: 0,
        emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      });
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
        "user-123",
        0,
      );
      expect(mocks.createRefreshToken).toHaveBeenCalledWith(
        "user-123",
        0,
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
        sessionVersion: 0,
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
        sessionVersion: 0,
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

    it("rejects refresh tokens issued before a password-change session epoch", async () => {
      prepareValidRefresh();
      mocks.findUniqueUser.mockResolvedValue({
        accountStatus: "ACTIVE",
        sessionVersion: 1,
        emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      await expect(refreshUserTokens("old-refresh-token")).rejects.toMatchObject({
        statusCode: 401,
        message: "Invalid or expired refresh token",
      });
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.createRefreshTokenRecord).not.toHaveBeenCalled();
    });

    it("rejects refresh from an unverified account", async () => {
      prepareValidRefresh();
      mocks.findUniqueUser.mockResolvedValue({
        accountStatus: "ACTIVE",
        sessionVersion: 0,
        emailVerifiedAt: null,
      });

      await expect(
        refreshUserTokens("old-refresh-token"),
      ).rejects.toMatchObject({ statusCode: 401 });
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("rechecks verification state under the account lock before rotating", async () => {
      prepareValidRefresh();
      mocks.findUniqueUser
        .mockReset()
        .mockResolvedValueOnce({
          accountStatus: "ACTIVE",
          sessionVersion: 0,
          emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
        })
        .mockResolvedValueOnce({
          accountStatus: "ACTIVE",
          sessionVersion: 0,
          emailVerifiedAt: null,
        });

      await expect(
        refreshUserTokens("old-refresh-token"),
      ).rejects.toMatchObject({ statusCode: 401 });
      expect(mocks.transaction).toHaveBeenCalledOnce();
      expect(mocks.createRefreshTokenRecord).not.toHaveBeenCalled();
    });
  });

  describe("logoutUser", () => {
    it("revokes a valid refresh token", async () => {
      mocks.verifyRefreshToken.mockResolvedValue({
        userId: "user-123",
        sessionVersion: 0,
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
          userId: "user-123",
          revokedAt: null,
        },
        data: { revokedAt: expect.any(Date) },
      });
      expect(mocks.updateRefreshTokens).toHaveBeenCalledTimes(2);
      expect(mocks.updateRefreshTokens).toHaveBeenCalledWith({
        where: {
          tokenHash: "stored-token-hash",
          userId: "user-123",
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { revokedAt: expect.any(Date) },
      });
      expect(mocks.updateUser).toHaveBeenCalledWith({
        where: { id: "user-123" },
        data: { sessionVersion: { increment: 1 } },
      });

      expect(result).toEqual({
        message: "Logged out successfully",
      });
      expect(mocks.transaction).toHaveBeenCalledOnce();
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
        sessionVersion: 0,
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

    it("rejects logout from an obsolete session epoch", async () => {
      mocks.verifyRefreshToken.mockResolvedValue({
        userId: "user-123",
        sessionVersion: 0,
      });
      mocks.findUniqueUser.mockResolvedValue({
        accountStatus: "ACTIVE",
        sessionVersion: 1,
        emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      await expect(logoutUser("stale-refresh-token")).rejects.toMatchObject({
        statusCode: 401,
      });
      expect(mocks.updateRefreshTokens).not.toHaveBeenCalled();
    });
  });
});
