import { Router } from "express";
import { getActivities } from "../../controllers/activityController.js";
import { authenticate } from "../../middleware/authMiddleware.js";

const router = Router();

// All activity routes require authentication.
router.use(authenticate);

// GET /api/v1/activities?page=1&limit=10
router.get("/", getActivities);

export default router;

