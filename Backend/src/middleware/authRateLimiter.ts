
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

export const isTestIsolationAllowed = (): boolean => {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_TEST_CLIENT_ISOLATION === "true"
  );
};

export const getAuthRateLimitKey = (req: Request): string => {
  const baseKey = ipKeyGenerator(req.ip ?? "");
  if (isTestIsolationAllowed()) {
    const testClientId = req.headers["x-test-client-id"];
    if (
      typeof testClientId === "string" &&
      /^[a-zA-Z0-9_-]{8,128}$/.test(testClientId)
    ) {
      return `${baseKey}:${testClientId}`;
    }
  }
  return baseKey;
};

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: getAuthRateLimitKey,
  message: {
    success: false,
    message: "Too many authentication attempts. Please try again in 15 minutes.",
  },
});
