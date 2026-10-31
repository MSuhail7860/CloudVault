import { Router } from "express";
import {
  createFolder,
  listFolders,
  deleteFolder,
  renameFolder,
} from "../../controllers/folderController.js";
import { authenticate } from "../../middleware/authMiddleware.js";

const router = Router();

// All folder endpoints require authentication.
router.use(authenticate);

router.post("/", createFolder);
router.get("/", listFolders);
router.patch("/:folderId/rename", renameFolder);
router.delete("/:folderId", deleteFolder);

export default router;
