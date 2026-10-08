import { Router } from "express";
import { prisma } from "../../config/database.js";

const router = Router();

router.get("/", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;

  res.json({
    status: "ok",
    service: "CloudVault API",
    database: "connected",
  });
});

export default router;