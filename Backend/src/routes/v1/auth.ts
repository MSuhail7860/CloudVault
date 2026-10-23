import { Router } from "express";
import {
  login,
  register,
  getMe,
  refresh,
  logout,
} from "../../controllers/authController.js";
import { authenticate } from "../../middleware/authMiddleware.js";
import { authRateLimiter } from "../../middleware/authRateLimiter.js";

const router = Router();

router.post("/register", authRateLimiter, register);
router.post("/login", authRateLimiter, login);
router.post("/refresh", authRateLimiter, refresh);
router.post("/logout", logout);

router.get("/me", authenticate, getMe);

export default router;
