import { Router } from "express";
import { getDashboard } from "../../controllers/dashboardController.js";
import { authenticate } from "../../middleware/authMiddleware.js";

const router = Router();

router.use(authenticate);

router.get("/", getDashboard);

export default router;
