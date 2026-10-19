import { Router } from "express";
import { downloadSharedFile } from "../../controllers/shareController.js";

const router = Router();

// Public download; token validation happens in the service.
router.get("/:token", downloadSharedFile);

export default router;
