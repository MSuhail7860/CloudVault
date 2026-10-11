import { Router } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import foldersRouter from "./folders.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    message: "CloudVault API v1",
  });
});

router.use("/health", healthRouter);
router.use("/auth", authRouter);
router.use("/folders", foldersRouter);

export default router;