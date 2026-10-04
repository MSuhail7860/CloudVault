import express from "express";
import cors from "cors";

import v1Router from "./routes/v1/index.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Root route
app.get("/", (_req, res) => {
  res.json({
    message: "CloudVault API is running",
  });
});

// API v1 routes
app.use("/api/v1", v1Router);

// 404 handler
app.use(notFound);

// Global error handler
app.use(errorHandler);

export default app;