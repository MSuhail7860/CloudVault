import { Router } from "express";
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
} from "../../controllers/shareController.js";
import { authenticate } from "../../middleware/authMiddleware.js";

const router = Router();

// All share-link management routes require authentication.
router.use(authenticate);

// POST /api/v1/shares/files/:id
router.post("/files/:id", createShareLink);

// GET /api/v1/shares/files/:id
router.get("/files/:id", listShareLinks);

// DELETE /api/v1/shares/:id
router.delete("/:id", revokeShareLink);

export default router;
