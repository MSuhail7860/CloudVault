import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

const accessSecret = "unit-test-access-secret-0123456789-abcdefgh";
const refreshSecret = "unit-test-refresh-secret-9876543210-abcdefgh";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("JWT session epochs", () => {
  it("rejects legacy tokens without a session version and preserves claims on new tokens", async () => {
    vi.stubEnv("JWT_ACCESS_SECRET", accessSecret);
    vi.stubEnv("JWT_REFRESH_SECRET", refreshSecret);

    const {
      createAccessToken,
      createRefreshToken,
      verifyAccessToken,
      verifyRefreshToken,
    } = await import("../jwt.js");
    const accessKey = new TextEncoder().encode(accessSecret);
    const refreshKey = new TextEncoder().encode(refreshSecret);

    const legacyAccessToken = await new SignJWT({ type: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-123")
      .setExpirationTime("2m")
      .sign(accessKey);
    const legacyRefreshToken = await new SignJWT({ type: "refresh" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-123")
      .setExpirationTime("2m")
      .sign(refreshKey);

    await expect(verifyAccessToken(legacyAccessToken)).rejects.toThrow(
      "Invalid access token",
    );
    await expect(verifyRefreshToken(legacyRefreshToken)).rejects.toThrow(
      "Invalid refresh token",
    );
    await expect(
      verifyAccessToken(await createAccessToken("user-123", 4)),
    ).resolves.toEqual({ userId: "user-123", sessionVersion: 4 });
    await expect(
      verifyRefreshToken(await createRefreshToken("user-123", 4)),
    ).resolves.toEqual({ userId: "user-123", sessionVersion: 4 });
  });
});
