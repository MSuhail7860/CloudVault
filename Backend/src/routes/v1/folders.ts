import { Router } from "express";
import {
  createFolder,
  listFolders,
  deleteFolder,
} from "../../controllers/folderController.js";
import { authenticate } from "../../middleware/authMiddleware.js";

const router = Router();

// All folder endpoints require authentication.
router.use(authenticate);

router.post("/", createFolder);
router.get("/", listFolders);
router.delete("/:folderId", deleteFolder);

export default router;
