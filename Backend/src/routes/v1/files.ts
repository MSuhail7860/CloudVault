import { Router } from "express";
import {
  uploadFile,
  listFiles,
  downloadFile,
  renameFile,
  moveFileToTrash,
  listTrashedFiles,
  restoreFileFromTrash,
  permanentlyDeleteFile,
} from "../../controllers/fileController.js";
import { authenticate } from "../../middleware/authMiddleware.js";
import { upload } from "../../middleware/uploadMiddleware.js";

const router = Router();

// All file routes require authentication.
router.use(authenticate);

// GET /api/v1/files/trash
router.get("/trash", listTrashedFiles);

// POST /api/v1/files/:id/restore
router.post("/:id/restore", restoreFileFromTrash);

// DELETE /api/v1/files/:id/permanent
router.delete("/:id/permanent", permanentlyDeleteFile);

// GET /api/v1/files
router.get("/", listFiles);

// POST /api/v1/files/upload
router.post("/upload", upload.single("file"), uploadFile);

// GET /api/v1/files/:id/download
router.get("/:id/download", downloadFile);

// PATCH /api/v1/files/:id/rename
router.patch("/:id/rename", renameFile);

// DELETE /api/v1/files/:id
// Moves the file to Trash; does not permanently delete it.
router.delete("/:id", moveFileToTrash);

export default router;