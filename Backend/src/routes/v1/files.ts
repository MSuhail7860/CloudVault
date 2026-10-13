import { Router } from "express";
import { uploadFile } from "../../controllers/fileController.js";
import { authenticate } from "../../middleware/authMiddleware.js";
import { upload } from "../../middleware/uploadMiddleware.js";

const router = Router();

// All file routes require authentication.
router.use(authenticate);

// POST /api/v1/files/upload
router.post("/upload", upload.single("file"), uploadFile);

export default router;
