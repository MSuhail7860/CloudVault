import { Router } from "express";
import {
  login,
  register,
  getMe,
  updateMe,
  changePassword,
  deleteMe,
  refresh,
  logout,
  resendVerification,
  verifyEmail,
} from "../../controllers/authController.js";
import { authenticate } from "../../middleware/authMiddleware.js";
import { authRateLimiter } from "../../middleware/authRateLimiter.js";

const router = Router();

router.post("/register", authRateLimiter, register);
router.post("/login", authRateLimiter, login);
router.post("/refresh", authRateLimiter, refresh);
router.post("/logout", authRateLimiter, logout);
router.post("/verification/resend", authRateLimiter, resendVerification);
router.post("/verification/verify", authRateLimiter, verifyEmail);

router.get("/me", authenticate, getMe);
router.patch("/me", authenticate, updateMe);
router.patch("/password", authRateLimiter, authenticate, changePassword);
router.delete("/me", authRateLimiter, authenticate, deleteMe);

export default router;
