
import "dotenv/config";
import { SignJWT, jwtVerify } from "jose";

const accessSecret = process.env.JWT_ACCESS_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET;

if (
  !accessSecret ||
  !refreshSecret ||
  accessSecret.length < 32 ||
  refreshSecret.length < 32 ||
  accessSecret === refreshSecret
) {
  throw new Error(
    "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be distinct values of at least 32 characters",
  );
}

const accessKey = new TextEncoder().encode(accessSecret);
const refreshKey = new TextEncoder().encode(refreshSecret);

export async function createAccessToken(
  userId: string,
  sessionVersion: number,
): Promise<string> {
  return new SignJWT({ type: "access", sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(accessKey);
}

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, accessKey, {
    algorithms: ["HS256"],
  });

  if (
    payload.type !== "access" ||
    !payload.sub ||
    typeof payload.sessionVersion !== "number" ||
    !Number.isInteger(payload.sessionVersion) ||
    payload.sessionVersion < 0
  ) {
    throw new Error("Invalid access token");
  }

  return { userId: payload.sub, sessionVersion: payload.sessionVersion };
}

export async function createRefreshToken(
  userId: string,
  sessionVersion: number,
): Promise<string> {
  return new SignJWT({ type: "refresh", sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(refreshKey);
}

export async function verifyRefreshToken(token: string) {
  const { payload } = await jwtVerify(token, refreshKey, {
    algorithms: ["HS256"],
  });

  if (
    payload.type !== "refresh" ||
    !payload.sub ||
    typeof payload.sessionVersion !== "number" ||
    !Number.isInteger(payload.sessionVersion) ||
    payload.sessionVersion < 0
  ) {
    throw new Error("Invalid refresh token");
  }

  return { userId: payload.sub, sessionVersion: payload.sessionVersion };
}
