import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { getAuthRateLimitKey } from "./middleware/authRateLimiter.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import v1Router from "./routes/v1/index.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { prisma } from "./config/database.js";
import { getRedisClient } from "./config/redis.js";
import { checkStorageConnection } from "./services/storageService.js";

const app = express();

const trustProxyHopsValue = process.env.TRUST_PROXY_HOPS ?? "0";
if (
  !/^(0|[1-9]\d*)$/.test(trustProxyHopsValue) ||
  !Number.isSafeInteger(Number(trustProxyHopsValue))
) {
  throw new Error("TRUST_PROXY_HOPS must be a non-negative integer");
}
app.set("trust proxy", Number(trustProxyHopsValue));

app.use(requestIdMiddleware);
app.use(helmet());

// Set FRONTEND_URL to your deployed frontend origin.
// Multiple origins can be comma-separated.
const allowedOrigins = (
  process.env.FRONTEND_URL ?? "http://localhost:3000"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests without an Origin header (e.g. server-to-server clients).
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
  }),
);

app.use(express.json({ limit: "100kb" }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.API_RATE_LIMIT_MAX) || 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: getAuthRateLimitKey,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

app.get("/", (_req, res) => {
  res.json({
    message: "CloudVault API is running",
  });
});

app.get("/health/ready", async (_req, res) => {
  let dependency = "database";
  try {
    await prisma.$queryRaw`SELECT 1`;
    dependency = "redis";
    const redis = getRedisClient();
    if (!redis) throw new Error("Redis is disabled");
    if (redis.status === "wait") {
      let timeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          redis.connect(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Redis readiness timed out")),
              2_000,
            );
            timeout.unref();
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    if (redis.status !== "ready") throw new Error("Redis is not ready");
    await redis.ping();
    dependency = "storage";
    await checkStorageConnection();
    res.status(200).json({ success: true, data: { status: "ready" } });
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "readiness_check_failed",
        dependency,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    res.status(503).json({
      success: false,
      data: { status: "unavailable" },
    });
  }
});

app.use("/api/v1", apiLimiter, v1Router);

app.use(notFound);
app.use(errorHandler);

export default app;