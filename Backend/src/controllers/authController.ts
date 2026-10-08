import { Request, Response } from "express";
import { registerUser } from "../services/authService.js";

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    const user = await registerUser(email, password, name);

    res.status(201).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error(error);

    res.status(400).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Registration failed",
    });
  }
};