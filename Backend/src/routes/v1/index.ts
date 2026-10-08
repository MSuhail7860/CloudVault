import { Router } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    message: "CloudVault API v1",
  });
});

router.use("/health", healthRouter);
router.use("/auth", authRouter);

export default router;