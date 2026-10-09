
import "dotenv/config";
import { SignJWT, jwtVerify } from "jose";

const accessSecret = process.env.JWT_ACCESS_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET;

if (!accessSecret || !refreshSecret) {
  throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be defined");
}

const accessKey = new TextEncoder().encode(accessSecret);
const refreshKey = new TextEncoder().encode(refreshSecret);

export async function createAccessToken(userId: string): Promise<string> {
  return new SignJWT({ type: "access" })
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

  if (payload.type !== "access" || !payload.sub) {
    throw new Error("Invalid access token");
  }

  return { userId: payload.sub };
}

export async function createRefreshToken(userId: string): Promise<string> {
  return new SignJWT({ type: "refresh" })
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

  if (payload.type !== "refresh" || !payload.sub) {
    throw new Error("Invalid refresh token");
  }

  return { userId: payload.sub };
}
