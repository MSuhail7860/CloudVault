import { Router } from "express";
import {
  createShareLink,
  listShareLinks,
  listSharesCreatedByMe,
  listSharesWithMe,
  updateSharePermission,
  revokeShareLink,
  downloadSharedFileForUser,
} from "../../controllers/shareController.js";
import { authenticate } from "../../middleware/authMiddleware.js";

const router = Router();

// All share-link management routes require authentication.
router.use(authenticate);

// GET /api/v1/shares/created-by-me
router.get("/created-by-me", listSharesCreatedByMe);

// GET /api/v1/shares/with-me
router.get("/with-me", listSharesWithMe);

// GET /api/v1/shares/with-me/:shareId/download
router.get("/with-me/:shareId/download", downloadSharedFileForUser);

// GET /api/v1/shares
router.get("/", listSharesCreatedByMe);

// POST /api/v1/shares/files/:id
router.post("/files/:id", createShareLink);

// GET /api/v1/shares/files/:id
router.get("/files/:id", listShareLinks);

// PATCH /api/v1/shares/:id
router.patch("/:id", updateSharePermission);

// DELETE /api/v1/shares/:id
router.delete("/:id", revokeShareLink);

export default router;
