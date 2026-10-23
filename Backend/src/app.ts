import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import v1Router from "./routes/v1/index.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

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
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
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

app.use("/api/v1", apiLimiter, v1Router);

app.use(notFound);
app.use(errorHandler);

export default app;