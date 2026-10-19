import { Router } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import foldersRouter from "./folders.js";
import { storageHealth } from "../../controllers/storageController.js";
import filesRouter from "./files.js";
import sharesRouter from "./shares.js";
import sharedRouter from "./shared.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    message: "CloudVault API v1",
  });
});

router.use("/health", healthRouter);
router.use("/auth", authRouter);
router.use("/folders", foldersRouter);
router.use("/files", filesRouter);
router.use("/shares", sharesRouter);
router.use("/shared", sharedRouter);

// Temporary object storage connection test
router.get("/storage/health", storageHealth);

export default router;